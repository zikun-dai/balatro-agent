import { promises as fs } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";


const PROTOCOL_VERSION = 1;
const HEARTBEAT_STALE_MS = 5_000;
const DEFAULT_RESPONSE_TIMEOUT_MS = 10_000;
const STATE_RETRY_COUNT = 3;
const STATE_RETRY_DELAY_MS = 50;
const RESPONSE_POLL_INTERVAL_MS = 50;


export interface BridgeConfig {
  bridgeDir?: string;
}

export interface Heartbeat {
  protocol_version: number;
  seq: number;
  phase: string;
  wrote_at: number;
  mod_version: string;
}

export interface StateEnvelope {
  protocol_version: number;
  seq: number;
  wrote_at: number;
  state_hash: string;
  payload: Record<string, unknown>;
}

export interface CommandEnvelope {
  protocol_version: number;
  seq: number;
  wrote_at: number;
  kind: string;
  args: Record<string, unknown>;
}

export interface ResponseEnvelope {
  seq: number;
  ok: boolean;
  error_code: string | null;
  error_message: string | null;
  data: Record<string, unknown> | null;
  applied_state_seq: number;
}

export interface ClientLock {
  pid: number;
  start_time: number;
}


export class BridgeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}


function resolveBridgeDir(config?: BridgeConfig): string {
  if (config?.bridgeDir) return config.bridgeDir;
  if (process.env.BALATRO_BRIDGE_DIR) return process.env.BALATRO_BRIDGE_DIR;
  return join(
    homedir(),
    "Library",
    "Application Support",
    "Balatro",
    "Mods",
    "balatro_mcp",
    "bridge",
  );
}

function padSeq(seq: number): string {
  return String(seq).padStart(6, "0");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

function seqFromFilename(name: string): number | undefined {
  const match = /^(\d+)\.json$/.exec(name);
  if (!match) return undefined;
  return Number(match[1]);
}

async function maxSeqInDir(path: string): Promise<number> {
  try {
    const entries = await fs.readdir(path);
    return entries.reduce((max, entry) => {
      const seq = seqFromFilename(entry);
      return seq === undefined ? max : Math.max(max, seq);
    }, 0);
  } catch {
    return 0;
  }
}

async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}


export class BridgeClient {
  private readonly bridgeDir: string;
  private commandSeq = 0;
  private connected = false;

  constructor(config?: BridgeConfig) {
    this.bridgeDir = resolveBridgeDir(config);
  }

  get dir(): string {
    return this.bridgeDir;
  }

  /**
   * Acquire the client lock. Throws INSTANCE_BUSY if another live client holds it.
   */
  async connect(): Promise<void> {
    await fs.mkdir(this.bridgeDir, { recursive: true });
    await fs.mkdir(join(this.bridgeDir, "commands"), { recursive: true });
    await fs.mkdir(join(this.bridgeDir, "responses"), { recursive: true });

    const lockPath = join(this.bridgeDir, ".client.lock");

    if (await fileExists(lockPath)) {
      try {
        const raw = await fs.readFile(lockPath, "utf-8");
        const existing: ClientLock = JSON.parse(raw);
        if (await isProcessAlive(existing.pid)) {
          throw new BridgeError(
            "INSTANCE_BUSY",
            `Another BridgeClient (pid ${existing.pid}) holds the lock`,
          );
        }
      } catch (err) {
        if (err instanceof BridgeError) throw err;
      }
    }

    const lock: ClientLock = {
      pid: process.pid,
      start_time: Date.now() / 1000,
    };
    const tmpPath = lockPath + ".tmp";
    await fs.writeFile(tmpPath, JSON.stringify(lock), "utf-8");
    await fs.rename(tmpPath, lockPath);

    this.connected = true;
    const commandsSeq = await maxSeqInDir(join(this.bridgeDir, "commands"));
    const responsesSeq = await maxSeqInDir(join(this.bridgeDir, "responses"));
    this.commandSeq = Math.max(commandsSeq, responsesSeq);
  }

  /**
   * Read the current game state with retry logic for mid-write races.
   * Validates protocol version, sequence, and freshness.
   *
   * @param options.maxAgeMs - Maximum acceptable age of state (default: heartbeat threshold)
   */
  async getState(options?: { maxAgeMs?: number }): Promise<StateEnvelope> {
    this.assertConnected();
    await this.assertGameRunning();

    const statePath = join(this.bridgeDir, "state.json");
    const maxAge = options?.maxAgeMs ?? HEARTBEAT_STALE_MS;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < STATE_RETRY_COUNT; attempt++) {
      try {
        const raw = await fs.readFile(statePath, "utf-8");
        const state: StateEnvelope = JSON.parse(raw);

        if (state.protocol_version !== PROTOCOL_VERSION) {
          throw new BridgeError(
            "PROTOCOL_MISMATCH",
            `Expected protocol version ${PROTOCOL_VERSION}, got ${state.protocol_version}`,
          );
        }

        if (typeof state.seq !== "number" || typeof state.wrote_at !== "number") {
          throw new BridgeError(
            "STATE_NOT_FOUND",
            "State envelope missing required fields (seq, wrote_at)",
          );
        }

        const stat = await fs.stat(statePath);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs > maxAge) {
          throw new BridgeError(
            "STATE_STALE",
            `State is ${Math.round(ageMs)}ms old (max: ${maxAge}ms)`,
          );
        }

        return state;
      } catch (err) {
        if (err instanceof BridgeError) throw err;
        lastError = err as Error;
        if (attempt < STATE_RETRY_COUNT - 1) {
          await sleep(STATE_RETRY_DELAY_MS);
        }
      }
    }

    if (lastError && "code" in lastError && (lastError as NodeJS.ErrnoException).code === "ENOENT") {
      throw new BridgeError("GAME_NOT_RUNNING", "state.json not found — game may not be running");
    }
    throw new BridgeError(
      "STATE_NOT_FOUND",
      `Failed to read state.json after ${STATE_RETRY_COUNT} attempts: ${lastError?.message}`,
    );
  }

  /**
   * Write a command to the bridge commands directory using atomic rename.
   * Returns the sequence number assigned to this command.
   *
   * @param options.kind - Command kind (e.g., "play_hand")
   * @param options.args - Command arguments
   * @param options.ttlMs - Time-to-live in ms (informational; Lua enforces)
   */
  async sendCommand(options: {
    kind: string;
    args?: Record<string, unknown>;
    ttlMs?: number;
  }): Promise<number> {
    this.assertConnected();

    this.commandSeq++;
    const seq = this.commandSeq;

    const envelope: CommandEnvelope = {
      protocol_version: PROTOCOL_VERSION,
      seq,
      wrote_at: Date.now() / 1000,
      kind: options.kind,
      args: options.args ?? {},
    };

    const filename = `${padSeq(seq)}.json`;
    const commandsDir = join(this.bridgeDir, "commands");
    const tmpPath = join(commandsDir, `${filename}.tmp`);
    const targetPath = join(commandsDir, filename);

    await fs.writeFile(tmpPath, JSON.stringify(envelope), "utf-8");
    await fs.rename(tmpPath, targetPath);

    return seq;
  }

  /**
   * Poll for a response file matching the given command sequence number.
   *
   * @param seq - Command sequence number to await
   * @param options.timeoutMs - Maximum wait time (default: 10s)
   */
  async awaitResponse(
    seq: number,
    options?: { timeoutMs?: number },
  ): Promise<ResponseEnvelope> {
    this.assertConnected();

    const timeout = options?.timeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
    const responsePath = join(this.bridgeDir, "responses", `${padSeq(seq)}.json`);
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      try {
        const raw = await fs.readFile(responsePath, "utf-8");
        const response: ResponseEnvelope = JSON.parse(raw);
        if (response.seq !== seq) {
          await sleep(RESPONSE_POLL_INTERVAL_MS);
          continue;
        }
        return response;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          await sleep(RESPONSE_POLL_INTERVAL_MS);
          continue;
        }
        await sleep(RESPONSE_POLL_INTERVAL_MS);
      }
    }

    throw new BridgeError(
      "STATE_STALE",
      `Timed out waiting for response to command seq ${seq} after ${timeout}ms`,
    );
  }

  /**
   * Release the client lock and clean up resources.
   */
  async dispose(): Promise<void> {
    if (!this.connected) return;

    const lockPath = join(this.bridgeDir, ".client.lock");
    try {
      await fs.unlink(lockPath);
    } catch {
    }

    this.connected = false;
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new BridgeError("INSTANCE_BUSY", "BridgeClient is not connected. Call connect() first.");
    }
  }

  private async assertGameRunning(): Promise<void> {
    const heartbeatPath = join(this.bridgeDir, "heartbeat.json");

    try {
      const stat = await fs.stat(heartbeatPath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs > HEARTBEAT_STALE_MS) {
        throw new BridgeError(
          "GAME_NOT_RUNNING",
          `Heartbeat is ${Math.round(ageMs)}ms old (threshold: ${HEARTBEAT_STALE_MS}ms)`,
        );
      }
    } catch (err) {
      if (err instanceof BridgeError) throw err;
      throw new BridgeError(
        "GAME_NOT_RUNNING",
        "heartbeat.json not found — game is not running",
      );
    }
  }
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Deps } from "../deps.js";
import { BridgeError } from "../bridge/client.js";
import { toolError } from "../errors.js";
import { formatResponse, type ResponseFormat } from "../response.js";

const START_RUN_DESCRIPTION =
  "Starts a new Balatro run from the MENU phase without requiring mouse or keyboard interaction. " +
  "Defaults to Red Deck on White Stake. Use this when the game is sitting on the main menu and no gameplay actions are available yet. " +
  "Error codes: WRONG_PHASE (not in MENU), INVALID_TARGET (deck or stake is invalid/unavailable), GAME_NOT_RUNNING (Balatro not running or heartbeat stale >5s), PROTOCOL_MISMATCH (server/mod version mismatch).";

const RETURN_TO_MENU_DESCRIPTION =
  "Returns Balatro to the main menu from the current run or game-over state. " +
  "Use this to recover after a failed run, a completed run, or a state where you intentionally want to abandon the current run. " +
  "Error codes: GAME_NOT_RUNNING (Balatro not running or heartbeat stale >5s), PROTOCOL_MISMATCH (server/mod version mismatch).";

const inputSchema = z
  .object({
    deck: z
      .enum([
        "RED",
        "BLUE",
        "YELLOW",
        "GREEN",
        "BLACK",
        "MAGIC",
        "NEBULA",
        "GHOST",
        "ABANDONED",
        "CHECKERED",
        "ZODIAC",
        "PAINTED",
        "ANAGLYPH",
        "PLASMA",
        "ERRATIC",
      ])
      .default("RED")
      .describe("Deck to start with."),
    stake: z
      .enum(["WHITE", "RED", "GREEN", "BLACK", "BLUE", "PURPLE", "ORANGE", "GOLD"])
      .default("WHITE")
      .describe("Stake difficulty to start with."),
    seed: z.string().optional().describe("Optional run seed."),
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe("Output format. Use 'json' for programmatic parsing, 'markdown' for human-readable summaries."),
  })
  .strict();

const ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

async function executeMenuCommand(
  deps: Deps,
  kind: "start_run" | "return_to_menu",
  args: Record<string, unknown>,
  format: ResponseFormat,
) {
  let response;

  try {
    const seq = await deps.bridgeClient.sendCommand({ kind, args });
    response = await deps.bridgeClient.awaitResponse(seq);
  } catch (err) {
    if (err instanceof BridgeError) {
      return { ...toolError(err.code, err.message) };
    }
    throw err;
  }

  if (!response.ok) {
    const code = response.error_code ?? "UNKNOWN_ERROR";
    const message = response.error_message ?? `Command ${kind} failed`;
    return { ...toolError(code, message, {
      seq: response.seq,
      applied_state_seq: response.applied_state_seq,
    }) };
  }

  const envelope = formatResponse(
    {
      ok: response.ok,
      seq: response.seq,
      applied_state_seq: response.applied_state_seq,
      data: response.data,
    },
    format,
  );
  return { ...envelope };
}

export function registerMenuTools(server: McpServer, deps: Deps): void {
  server.registerTool(
    "balatro_start_run",
    {
      description: START_RUN_DESCRIPTION,
      inputSchema,
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";
      return executeMenuCommand(
        deps,
        "start_run",
        {
          deck: args.deck ?? "RED",
          stake: args.stake ?? "WHITE",
          seed: args.seed,
        },
        format,
      );
    },
  );

  server.registerTool(
    "balatro_return_to_menu",
    {
      description: RETURN_TO_MENU_DESCRIPTION,
      inputSchema: z
        .object({
          response_format: z
            .enum(["markdown", "json"])
            .default("markdown")
            .describe("Output format. Use 'json' for programmatic parsing, 'markdown' for human-readable summaries."),
        })
        .strict(),
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";
      return executeMenuCommand(deps, "return_to_menu", {}, format);
    },
  );
}

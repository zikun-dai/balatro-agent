import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { Deps } from "./deps.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllResources } from "./resources/index.js";
import { registerAllPrompts } from "./prompts/index.js";

const SERVER_NAME = "balatro-mcp-server";

function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "package.json"),
    join(here, "..", "..", "package.json"),
  ];

  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, "utf-8");
      const parsed = JSON.parse(raw) as { name?: string; version?: string };
      if (parsed.name === SERVER_NAME && typeof parsed.version === "string") {
        return parsed.version;
      }
    } catch {
      continue;
    }
  }

  return "0.0.0";
}

export interface CreateServerOptions {
  deps: Deps;
}

export function createServer(options: CreateServerOptions): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: readPackageVersion(),
  });

  registerAllTools(server, options.deps);
  registerAllResources(server, options.deps);
  registerAllPrompts(server, options.deps);

  return server;
}

export interface RunServerOptions {
  deps: Deps;
  flushBridge?: () => Promise<void>;
}

export async function runServer(options: RunServerOptions): Promise<void> {
  const server = createServer({ deps: options.deps });
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`[balatro-mcp-server] received ${signal}, shutting down\n`);
    try {
      if (options.flushBridge) await options.flushBridge();
    } catch (err) {
      process.stderr.write(
        `[balatro-mcp-server] flushBridge failed: ${(err as Error).message}\n`,
      );
    }
    try {
      await server.close();
    } catch (err) {
      process.stderr.write(
        `[balatro-mcp-server] server.close failed: ${(err as Error).message}\n`,
      );
    }
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await server.connect(transport);
  process.stderr.write(`[balatro-mcp-server] connected on stdio\n`);
}

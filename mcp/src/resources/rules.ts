/**
 * Global rules resource: registers `balatro://rules/global` as a static MCP
 * resource backed by `mcp/data/rules/global.md`. Content loads once at module
 * init so the resource works without a bridge connection.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const RULES_URI = "balatro://rules/global";
const RULES_MIME = "text/markdown";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path math: this file lives at src/resources/ (or dist/resources/ when built),
// so `../../data/rules/global.md` lands at the package root in both cases.
const RULES_PATH = resolve(__dirname, "../../data/rules/global.md");

const RULES_CONTENT = readFileSync(RULES_PATH, "utf-8");
const RULES_STAT = statSync(RULES_PATH);

const RULES_VERSION = createHash("sha256")
  .update(RULES_CONTENT)
  .digest("hex")
  .substring(0, 8);

const RULES_LAST_UPDATED = RULES_STAT.mtime.toISOString();

/**
 * Register the global rules resource on an `McpServer`.
 * Safe to call without a bridge connection.
 */
export function registerRulesResource(server: McpServer): void {
  server.registerResource(
    "Global Game Rules",
    RULES_URI,
    {
      description:
        "Balatro game rules reference: run loop, phases, poker hands, money, modifiers, packs, stakes.",
      mimeType: RULES_MIME,
      _meta: {
        version: RULES_VERSION,
        lastUpdated: RULES_LAST_UPDATED,
      },
    },
    async () => ({
      contents: [
        {
          uri: RULES_URI,
          mimeType: RULES_MIME,
          text: RULES_CONTENT,
        },
      ],
    }),
  );
}

export function getRulesContent(): string {
  return RULES_CONTENT;
}

export function getRulesVersion(): string {
  return RULES_VERSION;
}

export function getRulesLastUpdated(): string {
  return RULES_LAST_UPDATED;
}

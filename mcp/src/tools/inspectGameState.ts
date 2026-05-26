import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Deps } from "../deps.js";
import { formatResponse, type ResponseFormat } from "../response.js";
import { toolError } from "../errors.js";
import { BridgeError } from "../bridge/client.js";

const DESCRIPTION =
  "Retrieves the complete current game state snapshot from the running Balatro instance. " +
  "Returns all information visible to the player: hand cards, jokers, consumables, money, blind info, " +
  "round progress, deck composition summary, shop contents (when in shop), and booster pack contents (when open). " +
  "This is the primary observation tool — call it before making any strategic decision to understand the current situation. " +
  "Output includes legal_actions[] indicating valid moves and rules_uri pointing to the full game rules resource. " +
  "Do NOT poll faster than 1 Hz; prefer calling once per decision point rather than repeatedly. " +
  "Error codes: GAME_NOT_RUNNING (Balatro not running or heartbeat stale >5s), PROTOCOL_MISMATCH (server/mod version mismatch).";

const inputSchema = z
  .object({
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe("Output format. Use 'json' for programmatic parsing, 'markdown' for human-readable summaries."),
  })
  .strict();

function stateToMarkdown(data: object): string {
  const d = data as Record<string, unknown>;
  const payload = (d.payload ?? {}) as Record<string, unknown>;

  const lines: string[] = [];
  lines.push("# Balatro Game State\n");

  if (d.seq !== undefined) lines.push(`**Seq:** ${d.seq}  `);
  if (payload.phase) lines.push(`**Phase:** ${String(payload.phase)}  `);
  if (payload.g_state) lines.push(`**G.STATE:** ${String(payload.g_state)}  `);
  if (payload.money !== undefined) lines.push(`**Money:** $${payload.money}  `);
  lines.push("");

  if (payload.ante !== undefined || payload.current_round !== undefined) {
    lines.push("## Round Info\n");
    if (payload.ante !== undefined) lines.push(`- **Ante:** ${payload.ante}`);
    if (payload.current_round !== undefined) lines.push(`- **Round:** ${payload.current_round}`);
    if (payload.hands_left !== undefined) lines.push(`- **Hands Left:** ${payload.hands_left}`);
    if (payload.discards_left !== undefined) lines.push(`- **Discards Left:** ${payload.discards_left}`);
    lines.push("");
  }

  if (payload.blind && typeof payload.blind === "object") {
    const blind = payload.blind as Record<string, unknown>;
    lines.push("## Blind\n");
    if (blind.name) lines.push(`- **Name:** ${blind.name}`);
    if (blind.chips !== undefined) lines.push(`- **Target Chips:** ${blind.chips}`);
    if (blind.chips_scored !== undefined) lines.push(`- **Chips Scored:** ${blind.chips_scored}`);
    lines.push("");
  }

  if (Array.isArray(payload.legal_actions) && payload.legal_actions.length > 0) {
    lines.push("## Legal Actions\n");
    for (const action of payload.legal_actions) {
      lines.push(`- \`${String(action)}\``);
    }
    lines.push("");
  }

  if (Array.isArray(payload.hand) && payload.hand.length > 0) {
    lines.push("## Hand\n");
    lines.push("| ID | Card | Enhancements |");
    lines.push("|---|---|---|");
    for (const card of payload.hand) {
      const c = card as Record<string, unknown>;
      lines.push(`| ${c.card_id ?? "?"} | ${c.display ?? c.name ?? "?"} | ${c.enhancements ?? "—"} |`);
    }
    lines.push("");
  }

  if (Array.isArray(payload.jokers) && payload.jokers.length > 0) {
    lines.push("## Jokers\n");
    for (const j of payload.jokers) {
      const joker = j as Record<string, unknown>;
      lines.push(`- **${joker.name ?? joker.card_id ?? "?"}** — ${joker.effect_text ?? ""}`);
    }
    lines.push("");
  }

  if (Array.isArray(payload.consumables) && payload.consumables.length > 0) {
    lines.push("## Consumables\n");
    for (const c of payload.consumables) {
      const con = c as Record<string, unknown>;
      lines.push(`- **${con.name ?? con.card_id ?? "?"}** — ${con.effect_text ?? ""}`);
    }
    lines.push("");
  }

  if (d.rules_uri) {
    lines.push(`---\n\n*Rules:* \`${d.rules_uri}\`\n`);
  }

  return lines.join("\n");
}

export function registerInspectGameState(server: McpServer, deps: Deps): void {
  server.registerTool(
    "balatro_inspect_game_state",
    {
      description: DESCRIPTION,
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";

      let state;
      try {
        state = await deps.bridgeClient.getState({ maxAgeMs: 1500 });
      } catch (err) {
        if (err instanceof BridgeError) {
          const envelope = toolError(err.code, err.message);
          return { ...envelope };
        }
        throw err;
      }

      const structured: Record<string, unknown> = {
        protocol_version: state.protocol_version,
        seq: state.seq,
        wrote_at: state.wrote_at,
        state_hash: state.state_hash,
        rules_uri: "balatro://rules/global",
        rules_version: state.protocol_version,
        payload: state.payload,
      };

      const envelope = formatResponse(structured, format, {
        toMarkdown: stateToMarkdown,
      });
      return { ...envelope };
    },
  );
}

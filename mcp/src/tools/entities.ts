import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Deps } from "../deps.js";
import { formatResponse, type ResponseFormat } from "../response.js";
import { toolError } from "../errors.js";

const LIST_DESCRIPTION =
  "Lists game entities from the Balatro entity catalog with optional type filtering and pagination. " +
  "Entities include jokers, tarot cards, planet cards, spectrals, vouchers, decks, blinds, tags, boosters, " +
  "enhancements, editions, seals, stakes, poker hands, stickers, challenges, and achievements. " +
  "Use the 'type' parameter to filter by entity category (e.g. 'joker', 'tarot', 'planet'). " +
  "Results are paginated — use 'offset' and 'limit' to page through large result sets. " +
  "Error codes: INVALID_TARGET (unknown entity type).";

const GET_DESCRIPTION =
  "Retrieves full details for a single Balatro game entity by its canonical ID. " +
  "Canonical IDs follow the format 'type/Name' (e.g. 'joker/Joker', 'tarot/The Fool', 'planet/Mercury'). " +
  "Returns the complete entity record including name, effect text, metadata, and source information. " +
  "Use balatro_list_game_entities first to discover available entity IDs if you don't know the exact ID. " +
  "Error codes: INVALID_TARGET (malformed ID, unknown type, or entity not found).";

const listInputSchema = z
  .object({
    type: z
      .string()
      .optional()
      .describe(
        "Entity type filter. Valid types: joker, tarot, planet, spectral, voucher, deck, blind, tag, booster, enhancement, edition, seal, stake, poker_hand, sticker, challenge, achievement.",
      ),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of entities to return per page. Min 1, max 100, default 20."),
    offset: z
      .number()
      .min(0)
      .default(0)
      .describe("Number of entities to skip for pagination. Default 0."),
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe("Output format. Use 'json' for programmatic parsing, 'markdown' for human-readable summaries."),
  })
  .strict();

const getInputSchema = z
  .object({
    id: z
      .string()
      .describe("Canonical entity ID in 'type/Name' format (e.g. 'joker/Joker', 'tarot/The Fool')."),
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe("Output format. Use 'json' for programmatic parsing, 'markdown' for human-readable summaries."),
  })
  .strict();

const ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function listToMarkdown(data: object): string {
  const d = data as Record<string, unknown>;
  const items = (d.items ?? []) as Array<Record<string, unknown>>;
  const lines: string[] = [];

  lines.push("# Game Entities\n");
  lines.push(`**Total:** ${d.total} | **Showing:** ${d.count} | **Offset:** ${d.offset}`);
  if (d.has_more) lines.push(`**Next offset:** ${d.next_offset}`);
  lines.push("");

  for (const item of items) {
    lines.push(`## ${item.name} (\`${item.id}\`)\n`);
    if (item.effect_text) lines.push(`${item.effect_text}\n`);
  }

  return lines.join("\n");
}

function entityToMarkdown(data: object): string {
  const d = data as Record<string, unknown>;
  const lines: string[] = [];

  lines.push(`# ${d.name}\n`);
  lines.push(`**ID:** \`${d.id}\`  `);
  lines.push(`**Type:** ${d.type}  `);
  lines.push("");

  if (d.effect_text) {
    lines.push("## Effect\n");
    lines.push(`${d.effect_text}\n`);
  }

  if (d.metadata && typeof d.metadata === "object" && Object.keys(d.metadata as object).length > 0) {
    lines.push("## Metadata\n");
    lines.push("```json");
    lines.push(JSON.stringify(d.metadata, null, 2));
    lines.push("```\n");
  }

  lines.push(`**Source:** ${d.source_url}  `);
  lines.push(`**License:** ${d.license}  `);

  return lines.join("\n");
}

export function registerEntityTools(server: McpServer, deps: Deps): void {
  server.registerTool(
    "balatro_list_game_entities",
    {
      description: LIST_DESCRIPTION,
      inputSchema: listInputSchema,
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";
      const limit = args.limit ?? 20;
      const offset = args.offset ?? 0;

      const result = (await deps.entityCatalog.list({
        type: args.type,
        limit,
        offset,
      })) as {
        items: Array<Record<string, unknown>>;
        total: number;
        count: number;
        offset: number;
        has_more: boolean;
        next_offset: number | null;
      };

      const structured: Record<string, unknown> = {
        items: result.items,
        total: result.total,
        count: result.count,
        offset: result.offset,
        has_more: result.has_more,
        next_offset: result.next_offset,
      };

      const envelope = formatResponse(structured, format, {
        toMarkdown: listToMarkdown,
        truncation: {
          total: result.total,
          count: result.count,
          offset: result.offset,
          has_more: result.has_more,
          next_offset: result.next_offset ?? undefined,
        },
      });
      return { ...envelope };
    },
  );

  server.registerTool(
    "balatro_get_game_entity",
    {
      description: GET_DESCRIPTION,
      inputSchema: getInputSchema,
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";

      let entity: Record<string, unknown>;
      try {
        entity = (await deps.entityCatalog.get(args.id)) as Record<string, unknown>;
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("INVALID_TARGET:")) {
          const msg = err.message.replace("INVALID_TARGET: ", "");
          return { ...toolError("INVALID_TARGET", msg) };
        }
        throw err;
      }

      const structured: Record<string, unknown> = { ...entity };

      const envelope = formatResponse(structured, format, {
        toMarkdown: entityToMarkdown,
      });
      return { ...envelope };
    },
  );
}

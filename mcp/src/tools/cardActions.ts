import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Deps } from "../deps.js";
import { formatResponse, type ResponseFormat } from "../response.js";
import { toolError } from "../errors.js";
import { BridgeError } from "../bridge/client.js";
import { cardIdSchema, normalizeCardId, normalizeCardIds, type CardId } from "./cardIds.js";

const USE_CONSUMABLE_DESCRIPTION =
  "Uses a consumable card (Tarot, Planet, or Spectral) from your consumable slots, applying its effect to the game state immediately. " +
  "Use this when you want to activate a consumable's effect — for example, enhancing cards with a Tarot, upgrading a poker hand level with a Planet, or triggering a Spectral card's special ability. " +
  "Do NOT call this on Joker cards (they are passive and cannot be 'used'), on cards not present in your consumable slots, or outside of a phase where consumable use is permitted (e.g. during blind selection without cards dealt). " +
  "Error codes: INVALID_TARGET (card_id not found in consumable slots or not a usable consumable), WRONG_PHASE (consumable use not allowed in current phase), GAME_NOT_RUNNING (Balatro not running or heartbeat stale >5s), PROTOCOL_MISMATCH (server/mod version mismatch).";

const SELL_CARD_DESCRIPTION =
  "Sells a card (Joker or consumable) from your slots for its sell value in dollars, permanently removing it from your possession. " +
  "Use this when you need cash to buy a better card from the shop, when a Joker no longer fits your build, or when you need to free up a slot for an incoming card. " +
  "Do NOT call this on cards in your hand (playing cards cannot be sold this way), on cards not present in your Joker or consumable slots, or outside of a phase where selling is permitted. " +
  "Error codes: INVALID_TARGET (card_id not found in sellable slots), WRONG_PHASE (selling not allowed in current phase), GAME_NOT_RUNNING (Balatro not running or heartbeat stale >5s), PROTOCOL_MISMATCH (server/mod version mismatch).";

const useConsumableSchema = z
  .object({
    card_id: z
      .union([z.string(), z.number().int()])
      .describe("The ID of the consumable card to use from your consumable slots."),
    targets: z
      .array(cardIdSchema)
      .optional()
      .describe("Optional target card IDs for consumables that operate on hand cards. Omit for cards that take no targets."),
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe("Output format. Use 'json' for programmatic parsing, 'markdown' for human-readable summaries."),
  })
  .strict();

const sellCardSchema = z
  .object({
    card_id: z
      .union([z.string(), z.number().int()])
      .describe("The ID of the card to sell — must be a Joker or consumable in your slots."),
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

async function executeCardAction(
  deps: Deps,
  kind: "use_consumable" | "sell_card",
  cardId: CardId,
  format: ResponseFormat,
  targetCardIds?: CardId[],
) {
  let response;
  try {
    const args: Record<string, unknown> = { card_id: cardId };
    if (targetCardIds) args.target_card_ids = targetCardIds;
    const seq = await deps.bridgeClient.sendCommand({ kind, args });
    response = await deps.bridgeClient.awaitResponse(seq);
  } catch (err) {
    if (err instanceof BridgeError) {
      return toolError(err.code, err.message);
    }
    throw err;
  }

  if (!response.ok) {
    const code = response.error_code ?? "UNKNOWN_ERROR";
    const message = response.error_message ?? `Command ${kind} failed`;
    return toolError(code, message, {
      seq: response.seq,
      applied_state_seq: response.applied_state_seq,
    });
  }

  const structured: Record<string, unknown> = {
    ok: response.ok,
    seq: response.seq,
    applied_state_seq: response.applied_state_seq,
    data: response.data,
  };

  return formatResponse(structured, format);
}

export function registerCardActionTools(server: McpServer, deps: Deps): void {
  server.registerTool(
    "balatro_use_consumable",
    {
      description: USE_CONSUMABLE_DESCRIPTION,
      inputSchema: useConsumableSchema,
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";
      const targets = args.targets ? normalizeCardIds(args.targets) : undefined;
      const envelope = await executeCardAction(deps, "use_consumable", normalizeCardId(args.card_id), format, targets);
      return { ...envelope };
    },
  );

  server.registerTool(
    "balatro_sell_card",
    {
      description: SELL_CARD_DESCRIPTION,
      inputSchema: sellCardSchema,
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";
      const envelope = await executeCardAction(deps, "sell_card", normalizeCardId(args.card_id), format);
      return { ...envelope };
    },
  );
}

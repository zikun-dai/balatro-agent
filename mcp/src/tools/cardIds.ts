import { z } from "zod";

export const cardIdSchema = z.union([z.string(), z.number().int()]);

export type CardId = z.infer<typeof cardIdSchema>;

export function normalizeCardId(cardId: CardId): CardId {
  return cardId;
}

export function normalizeCardIds(cardIds: CardId[]): CardId[] {
  return cardIds.map(normalizeCardId);
}

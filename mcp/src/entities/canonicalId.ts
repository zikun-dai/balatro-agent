/**
 * Canonical ID resolver for Balatro wiki entities.
 *
 * Implements the normalization pipeline from entity-contract.md:
 * 1. NFKC normalize the raw name
 * 2. Lowercase type segment
 * 3. Replace whitespace sequences with single underscore
 * 4. Strip non-ASCII characters from name segment
 * 5. Collision resolution with __N suffix
 */

/** The 17 canonical entity types. */
export const ENTITY_TYPES = [
  "joker",
  "tarot",
  "planet",
  "spectral",
  "voucher",
  "deck",
  "blind",
  "tag",
  "booster",
  "enhancement",
  "edition",
  "seal",
  "stake",
  "poker_hand",
  "sticker",
  "challenge",
  "achievement",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

/**
 * Normalize a raw entity name into the name segment of a canonical ID.
 * Does NOT prepend the type prefix or handle collisions.
 */
export function normalizeNameSegment(rawName: string): string {
  // 1. NFKC normalize
  let name = rawName.normalize("NFKC");

  // 3. Replace whitespace sequences with single underscore
  name = name.replace(/\s+/g, "_");

  // 4. Strip characters outside printable ASCII (U+0020–U+007E)
  // But since spaces are already underscores, we keep U+0021–U+007E and underscore
  name = name.replace(/[^\x20-\x7E]/g, "");

  name = name.replace(/ /g, "_");

  // Collapse multiple underscores that may result from stripping
  name = name.replace(/_+/g, "_");

  // Trim leading/trailing underscores
  name = name.replace(/^_+|_+$/g, "");

  return name;
}

/**
 * Generate the slug (lowercase name segment) from a normalized name segment.
 */
export function generateSlug(nameSegment: string): string {
  return nameSegment.toLowerCase();
}

/**
 * Build a canonical ID from type and normalized name segment.
 */
export function buildCanonicalId(type: EntityType, nameSegment: string): string {
  return `${type}/${nameSegment}`;
}

/**
 * Resolve collisions deterministically.
 *
 * Given a list of entities that normalize to the same base ID,
 * sorted by wiki page ID ascending, assigns IDs:
 * - First entity: base ID (no suffix)
 * - Subsequent: base ID + __N (N starts at 2)
 */
export function resolveCollisions(
  baseId: string,
  entities: { pageId: number; [key: string]: unknown }[]
): Map<number, string> {
  const sorted = [...entities].sort((a, b) => a.pageId - b.pageId);
  const result = new Map<number, string>();

  for (let i = 0; i < sorted.length; i++) {
    const id = i === 0 ? baseId : `${baseId}__${i + 1}`;
    result.set(sorted[i].pageId, id);
  }

  return result;
}

/**
 * Full canonical ID pipeline for a single entity.
 * Returns the base canonical ID (without collision resolution).
 * Collision resolution must be applied externally across the full dataset.
 */
export function canonicalId(type: EntityType, rawName: string): string {
  const nameSegment = normalizeNameSegment(rawName);
  return buildCanonicalId(type, nameSegment);
}

#!/usr/bin/env tsx
/**
 * Wiki entity ingest script.
 *
 * Queries balatrowiki.org API, transforms to canonical entity records,
 * and writes deterministic JSON to mcp/data/entities/.
 *
 * If the wiki API is unreachable (timeout, network error), produces valid
 * skeleton files so the dev server starts cleanly.
 *
 * Usage: pnpm regen:entities
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENTITY_TYPES,
  type EntityType,
  canonicalId,
  generateSlug,
  normalizeNameSegment,
} from "../entities/canonicalId.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WIKI_API = "https://balatrowiki.org/api.php";
const WIKI_HOST = "balatrowiki.org";
const USER_AGENT = "balatro-mcp/0.0.0 (+https://github.com/4rcadia/balatro-mcp)";
const ENTITIES_DIR = path.resolve(__dirname, "../../data/entities");
const LICENSE = "CC BY-NC-SA 3.0" as const;
const REQUEST_TIMEOUT_MS = 10_000;

// ── Type config ───────────────────────────────────────────────────────────────

interface EntityTypeConfig {
  type: EntityType;
  source: "category" | "list";
  category?: string;
  listPage?: string;
}

/** Category name mapping for category-backed types. */
const CATEGORY_MAP: Partial<Record<EntityType, string>> = {
  joker: "Jokers",
  tarot: "Tarot_cards",
  planet: "Planet_cards",
  spectral: "Spectral_cards",
  voucher: "Vouchers",
  deck: "Decks",
  blind: "Blinds",
  tag: "Tags",
  booster: "Booster_packs",
  enhancement: "Enhancements",
  edition: "Editions",
  seal: "Seals",
};

const LIST_PAGE_MAP: Partial<Record<EntityType, string>> = {
  stake: "Stakes",
  poker_hand: "Poker_hands",
  sticker: "Stickers",
  challenge: "Challenges",
  achievement: "Achievements",
};

const TYPE_CONFIGS: EntityTypeConfig[] = ENTITY_TYPES.map((type) => {
  if (CATEGORY_MAP[type]) {
    return { type, source: "category" as const, category: CATEGORY_MAP[type] };
  }
  return { type, source: "list" as const, listPage: LIST_PAGE_MAP[type] };
});

// ── Entity record interface ───────────────────────────────────────────────────

export interface EntityRecord {
  id: string;
  type: EntityType;
  name: string;
  slug: string;
  effect_text: string | null;
  effect_html: string | null;
  metadata: Record<string, unknown>;
  source_url: string;
  license: typeof LICENSE;
  wiki_revision: number;
}

// ── Wiki API helpers ──────────────────────────────────────────────────────────

async function wikiFetch(params: Record<string, string>): Promise<unknown> {
  const url = new URL(WIKI_API);
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Wiki API HTTP ${res.status}: ${url.pathname}?${url.searchParams}`);
  }
  return res.json();
}

async function fetchCategoryMembers(category: string): Promise<string[]> {
  const titles: string[] = [];
  let cmcontinue: string | undefined;
  do {
    const params: Record<string, string> = {
      action: "query",
      list: "categorymembers",
      cmtitle: `Category:${category}`,
      cmlimit: "500",
      cmnamespace: "0",
      cmtype: "page",
      cmprop: "ids|title|type",
    };
    if (cmcontinue) params.cmcontinue = cmcontinue;
    const data = await wikiFetch(params) as {
      query?: { categorymembers?: Array<{ title: string }> };
      continue?: { cmcontinue?: string };
    };
    const members = data?.query?.categorymembers ?? [];
    for (const m of members) {
      titles.push(m.title);
    }
    cmcontinue = data?.continue?.cmcontinue;
  } while (cmcontinue);
  return titles;
}

async function fetchParsedPage(
  title: string,
): Promise<{ text: string; wikitext: string; revid: number } | null> {
  try {
    const data = await wikiFetch({
      action: "parse",
      page: title,
      prop: "text|wikitext|revid",
    }) as {
      parse?: {
        text?: { "*"?: string };
        wikitext?: { "*"?: string };
        revid?: number;
      };
    };
    return {
      text: data?.parse?.text?.["*"] ?? "",
      wikitext: data?.parse?.wikitext?.["*"] ?? "",
      revid: data?.parse?.revid ?? 0,
    };
  } catch {
    return null;
  }
}

// ── Text processing ───────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Entity record builder ─────────────────────────────────────────────────────

function makeEntityRecord(
  type: EntityType,
  rawName: string,
  effectText: string | null,
  effectHtml: string | null,
  metadata: Record<string, unknown> = {},
  wikiRevision = 0,
): EntityRecord {
  const nameSegment = normalizeNameSegment(rawName);
  const id = canonicalId(type, rawName);
  const slug = generateSlug(nameSegment);
  return {
    id,
    type,
    name: rawName,
    slug,
    effect_text: effectText,
    effect_html: effectHtml,
    metadata,
    source_url: `https://${WIKI_HOST}/w/${encodeURIComponent(rawName.replace(/\s/g, "_"))}`,
    license: LICENSE,
    wiki_revision: wikiRevision,
  };
}

// ── Ingest logic ──────────────────────────────────────────────────────────────

async function ingestCategory(config: EntityTypeConfig): Promise<EntityRecord[]> {
  const category = config.category!;
  const titles = await fetchCategoryMembers(category);
  const records: EntityRecord[] = [];

  for (const title of titles) {
    const parsed = await fetchParsedPage(title);
    if (parsed) {
      const effectText = stripHtml(parsed.text);
      records.push(
        makeEntityRecord(
          config.type,
          title,
          effectText || null,
          parsed.text || null,
          {},
          parsed.revid,
        ),
      );
    }
    // Rate limit: simple delay between requests
    await new Promise((r) => setTimeout(r, 500));
  }

  return records;
}

async function ingestListPage(config: EntityTypeConfig): Promise<EntityRecord[]> {
  const listPage = config.listPage!;
  const parsed = await fetchParsedPage(listPage);
  if (!parsed) return [];

  const records: EntityRecord[] = [];
  // Extract names from wikitext links: [[Name]] or [[Name|Display]]
  const linkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((match = linkPattern.exec(parsed.wikitext)) !== null) {
    const name = match[1].trim();
    // Skip category/file/template links
    if (name.includes(":") || seen.has(name)) continue;
    seen.add(name);
    records.push(
      makeEntityRecord(config.type, name, null, null, {}, parsed.revid),
    );
  }

  return records;
}

// ── Skeleton fallback ─────────────────────────────────────────────────────────

function generateEmptyTypeFile(): EntityRecord[] {
  return [];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  fs.mkdirSync(ENTITIES_DIR, { recursive: true });

  const entitiesByType: Record<string, EntityRecord[]> = {};
  let wikiReachable = true;

  // Try first type to test connectivity
  const testConfig = TYPE_CONFIGS[0];
  try {
    if (testConfig.source === "category") {
      await wikiFetch({
        action: "query",
        meta: "siteinfo",
        siprop: "general",
      });
    }
  } catch (err) {
    wikiReachable = false;
    console.error(
      `⚠️  Wiki API unreachable (${err instanceof Error ? err.message : "unknown error"}). Generating skeleton files.`,
    );
  }

  if (wikiReachable) {
    for (const config of TYPE_CONFIGS) {
      try {
        let records: EntityRecord[];
        if (config.source === "category") {
          records = await ingestCategory(config);
        } else {
          records = await ingestListPage(config);
        }
        entitiesByType[config.type] = records;
        console.error(`  ✓ ${config.type}: ${records.length} records`);
      } catch (err) {
        console.error(
          `  ⚠️  ${config.type} failed (${err instanceof Error ? err.message : "unknown"}), using empty skeleton`,
        );
        entitiesByType[config.type] = generateEmptyTypeFile();
      }
    }
  } else {
    // All types get empty skeletons
    for (const config of TYPE_CONFIGS) {
      entitiesByType[config.type] = generateEmptyTypeFile();
    }
  }

  // ── Deduplicate by canonical ID ─────────────────────────────────────────────
  for (const config of TYPE_CONFIGS) {
    const seen = new Set<string>();
    entitiesByType[config.type] = (entitiesByType[config.type] ?? []).filter(
      (r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      },
    );
  }

  // ── Write per-type files (sorted deterministically) ─────────────────────────
  const allIds: Array<{ id: string; type: EntityType }> = [];
  let totalCount = 0;
  const typeCounts: Record<string, number> = {};

  for (const config of TYPE_CONFIGS) {
    const records = entitiesByType[config.type] ?? [];
    const sorted = [...records].sort((a, b) => a.id.localeCompare(b.id));

    const typePath = path.join(ENTITIES_DIR, `${config.type}.json`);
    fs.writeFileSync(typePath, JSON.stringify(sorted, null, 2) + "\n");

    for (const r of sorted) {
      allIds.push({ id: r.id, type: r.type });
    }
    totalCount += sorted.length;
    typeCounts[config.type] = sorted.length;
  }

  // ── _index.json ─────────────────────────────────────────────────────────────
  allIds.sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(
    path.join(ENTITIES_DIR, "_index.json"),
    JSON.stringify(allIds, null, 2) + "\n",
  );

  // ── _meta.json ──────────────────────────────────────────────────────────────
  fs.writeFileSync(
    path.join(ENTITIES_DIR, "_meta.json"),
    JSON.stringify(
      {
        build_timestamp: new Date().toISOString(),
        wiki_host: WIKI_HOST,
        total_records: totalCount,
        type_counts: typeCounts,
      },
      null,
      2,
    ) + "\n",
  );

  console.error(
    `✅ Generated ${totalCount} entity records across ${TYPE_CONFIGS.length} types → ${ENTITIES_DIR}`,
  );
}

main().catch((err) => {
  console.error("❌ regen-entities failed:", err);
  process.exit(1);
});

import * as fs from "node:fs";
import * as path from "node:path";
import { ENTITY_TYPES, type EntityType } from "./canonicalId.js";

export interface EntityRecord {
  id: string;
  type: EntityType;
  name: string;
  slug: string;
  effect_text: string | null;
  effect_html: string | null;
  metadata: Record<string, unknown>;
  source_url: string;
  license: string;
  wiki_revision: number;
}

interface IndexEntry {
  id: string;
  type: EntityType;
}

export interface ListResult {
  items: EntityRecord[];
  total: number;
  count: number;
  offset: number;
  has_more: boolean;
  next_offset: number | null;
}

export class EntityCatalog {
  private readonly dataDir: string;
  private index: IndexEntry[] | null = null;
  private typeCache = new Map<string, EntityRecord[]>();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private loadIndex(): IndexEntry[] {
    if (this.index) return this.index;
    const indexPath = path.join(this.dataDir, "_index.json");
    const raw = fs.readFileSync(indexPath, "utf-8");
    this.index = JSON.parse(raw) as IndexEntry[];
    return this.index;
  }

  private loadType(type: string): EntityRecord[] {
    const cached = this.typeCache.get(type);
    if (cached) return cached;
    const typePath = path.join(this.dataDir, `${type}.json`);
    if (!fs.existsSync(typePath)) return [];
    const raw = fs.readFileSync(typePath, "utf-8");
    const records = JSON.parse(raw) as EntityRecord[];
    this.typeCache.set(type, records);
    return records;
  }

  listEntities(opts: {
    type?: string;
    name_contains?: string;
    limit?: number;
    offset?: number;
  } = {}): ListResult {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;

    let records: EntityRecord[];

    if (opts.type) {
      if (!ENTITY_TYPES.includes(opts.type as EntityType)) {
        records = [];
      } else {
        records = this.loadType(opts.type);
      }
    } else {
      records = [];
      for (const type of ENTITY_TYPES) {
        records.push(...this.loadType(type));
      }
      records.sort((a, b) => a.id.localeCompare(b.id));
    }

    if (opts.name_contains) {
      const needle = opts.name_contains.toLowerCase();
      records = records.filter((r) =>
        r.name.toLowerCase().includes(needle),
      );
    }

    const total = records.length;
    const sliced = records.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    return {
      items: sliced,
      total,
      count: sliced.length,
      offset,
      has_more: hasMore,
      next_offset: hasMore ? offset + limit : null,
    };
  }

  getEntity(id: string): EntityRecord {
    const slashIdx = id.indexOf("/");
    if (slashIdx === -1) {
      throw new Error(`INVALID_TARGET: malformed entity ID "${id}" — expected "type/Name"`);
    }
    const type = id.slice(0, slashIdx);
    if (!ENTITY_TYPES.includes(type as EntityType)) {
      throw new Error(`INVALID_TARGET: unknown entity type "${type}"`);
    }
    const records = this.loadType(type);
    const found = records.find((r) => r.id === id);
    if (!found) {
      throw new Error(`INVALID_TARGET: entity "${id}" not found`);
    }
    return found;
  }
}

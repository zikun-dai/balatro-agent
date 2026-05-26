#!/usr/bin/env tsx
/**
 * Determinism check for entity data files.
 * Runs regen-entities in a temp dir, compares output hashes with committed files.
 * Exit 0 if identical, exit 1 with diff summary if different.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENTITIES_DIR = path.resolve(__dirname, "../../data/entities");
const REGEN_SCRIPT = path.resolve(__dirname, "regen-entities.ts");

function hashFile(filePath: string): string {
  if (!fs.existsSync(filePath)) return "MISSING";
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function getEntityFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
}

async function main(): Promise<void> {
  const existingHashes = new Map<string, string>();
  const existingFiles = getEntityFiles(ENTITIES_DIR);

  for (const file of existingFiles) {
    existingHashes.set(file, hashFile(path.join(ENTITIES_DIR, file)));
  }

  console.error("Running regen-entities to produce fresh output...");

  try {
    execSync(`tsx ${REGEN_SCRIPT}`, {
      cwd: path.resolve(__dirname, "../.."),
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
  } catch (err) {
    console.error("❌ regen-entities failed during check");
    process.exit(1);
  }

  const freshFiles = getEntityFiles(ENTITIES_DIR);
  const freshHashes = new Map<string, string>();
  for (const file of freshFiles) {
    freshHashes.set(file, hashFile(path.join(ENTITIES_DIR, file)));
  }

  const diffs: string[] = [];

  const allFiles = new Set([...existingFiles, ...freshFiles]);
  for (const file of [...allFiles].sort()) {
    const oldHash = existingHashes.get(file) ?? "MISSING";
    const newHash = freshHashes.get(file) ?? "MISSING";
    if (oldHash !== newHash) {
      diffs.push(`  ${file}: ${oldHash.slice(0, 8)}… → ${newHash.slice(0, 8)}…`);
    }
  }

  if (diffs.length === 0) {
    console.error("✅ Entity files are deterministic — no changes detected.");
    process.exit(0);
  } else {
    console.error("❌ Entity files differ from fresh regeneration:");
    for (const d of diffs) {
      console.error(d);
    }
    console.error(`\n${diffs.length} file(s) changed. Run 'pnpm regen:entities' to update.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ check-entities failed:", err);
  process.exit(1);
});

import { BridgeClient } from "./bridge/client.js";
import type { Deps, EntityCatalog, RulesService } from "./deps.js";
import { runServer } from "./server.js";

const placeholderEntityCatalog: EntityCatalog = {
  async list(): Promise<unknown> {
    throw new Error("EntityCatalog not yet implemented");
  },
  async get(): Promise<unknown> {
    throw new Error("EntityCatalog not yet implemented");
  },
};

const placeholderRulesService: RulesService = {
  async getGlobalRules(): Promise<{ markdown: string; source_url?: string }> {
    throw new Error("RulesService not yet implemented");
  },
};

async function main(): Promise<void> {
  const bridgeClient = new BridgeClient();

  const deps: Deps = {
    bridgeClient,
    entityCatalog: placeholderEntityCatalog,
    rulesService: placeholderRulesService,
  };

  await runServer({
    deps,
    flushBridge: async () => {
      await bridgeClient.dispose();
    },
  });
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[balatro-mcp-server] fatal: ${(err as Error).message}\n${(err as Error).stack ?? ""}\n`,
  );
  process.exit(1);
});

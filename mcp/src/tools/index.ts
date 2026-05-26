import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../deps.js";
import { registerInspectGameState } from "./inspectGameState.js";

export function registerAllTools(server: McpServer, deps: Deps): void {
  registerInspectGameState(server, deps);
}

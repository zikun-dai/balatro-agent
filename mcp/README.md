# balatro-mcp-server

MCP server providing tools and resources for Balatro mod development.
Communicates with Balatro via a WebSocket plugin mod.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run compiled server |
| `pnpm dev` | Run with tsx (watch mode) |
| `pnpm typecheck` | Type-check without emitting |
| `pnpm regen:entities` | Regenerate entity definitions |
| `pnpm check:entities` | Validate entity definitions |
| `pnpm audit:tools` | Audit registered tools |

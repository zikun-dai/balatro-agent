/**
 * Strategy context prompt: registers the argsless `balatro_strategy_context`
 * prompt that returns the global rules markdown plus a short instruction
 * block on canonical IDs and tool usage. Independent of the bridge.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getRulesContent,
  getRulesVersion,
  getRulesLastUpdated,
} from "../resources/rules.js";

const PROMPT_NAME = "balatro_strategy_context";

const INSTRUCTION_BLOCK = `## How to Use This Context

When advising on a Balatro run, ground every recommendation in the rules
above and the live game state available through MCP tools.

### Canonical IDs

Every Balatro entity (joker, tarot, planet, voucher, deck, blind, tag,
booster, enhancement, edition, seal, stake, poker_hand, sticker, challenge,
achievement) has a stable canonical ID of the form \`<type>/<name_segment>\`,
e.g. \`joker/blueprint\`, \`tarot/the_fool\`, \`voucher/overstock\`. Names are
NFKC-normalized, ASCII-only, lowercase, and underscore-separated. Collisions
are disambiguated with a \`__N\` suffix (\`__2\`, \`__3\`, …).

Always refer to entities by canonical ID in tool arguments and when citing
specific cards in your reasoning. Resolve unfamiliar names via the entities
resources before issuing commands.

### Tool Usage

- Read the live state with the \`get_state\` tool before recommending an
  action; the rules above describe phases and constraints, but only the
  state tells you what is actually playable right now.
- Issue actions through the typed bridge tools (e.g. \`play_hand\`,
  \`discard\`, \`buy_card\`, \`skip_blind\`). Use canonical IDs for any card
  argument.
- Tools return \`GAME_NOT_RUNNING\` when no Balatro instance is connected.
  Treat that as a hard stop — do not fabricate state or outcomes.
- Tools are idempotent on the seq number; never replay a command unless the
  bridge explicitly reports it was lost.

### Reasoning Style

State the phase, blind, money, and decisive constraints before suggesting a
move. Prefer concrete, citable rules ("Boss Blinds cannot be skipped") over
generic advice. When tradeoffs exist, name both options and the rule that
breaks the tie.`;

export function registerStrategyPrompt(server: McpServer): void {
  server.registerPrompt(
    PROMPT_NAME,
    {
      title: "Balatro Strategy Context",
      description:
        "Loads the global rules reference and instructions on canonical IDs and tool usage for advising on Balatro runs.",
    },
    () => ({
      description: `Balatro strategy context (rules version ${getRulesVersion()}, updated ${getRulesLastUpdated()})`,
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `${getRulesContent()}\n\n---\n\n${INSTRUCTION_BLOCK}`,
          },
        },
      ],
    }),
  );
}

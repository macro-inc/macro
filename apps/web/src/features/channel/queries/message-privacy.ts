import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import { useIsAuthenticated } from '@core/context/user';
import { useAgentsQuery } from '@queries/agents/agents';
import { queryReadyGate } from '@queries/gate';
import { type Accessor, createMemo } from 'solid-js';

export function useEphemeralMentionAgent(
  mentions: Accessor<ItemMention[]>,
  enabled: Accessor<boolean>
) {
  const authenticated = useIsAuthenticated();
  const agents = useAgentsQuery(() => enabled() && authenticated() === true);
  return createMemo(() => {
    if (!enabled() || authenticated() !== true || !queryReadyGate(agents)) {
      return undefined;
    }
    const ids = new Set(mentions().map((mention) => mention.itemId));
    return agents.data.find(
      (agent) => agent.is_ephemeral && ids.has(`bot|${agent.bot.id}`)
    );
  });
}

import type { AgentsMode } from './mode';
import type { AgentConversationTarget } from './recent-conversations';

const PREFIX = 'agents-session~';

export type AgentsRoute = {
  mode: AgentsMode;
  conversation: AgentConversationTarget;
};

/** Distinct component identities preserve each conversation in split history. */
export function agentsRouteId(route: AgentsRoute): string {
  const section =
    route.conversation.type === 'chat'
      ? 'agent-chats'
      : route.mode === 'code'
        ? 'coders'
        : 'agents';
  return `${PREFIX}${section}~${route.conversation.id}`;
}

export function parseAgentsRoute(id: string): AgentsRoute | undefined {
  if (!id.startsWith(PREFIX)) return;
  const [section, conversationId, extra] = id.slice(PREFIX.length).split('~');
  if (!conversationId || extra !== undefined) return;
  if (section !== 'agents' && section !== 'coders' && section !== 'agent-chats')
    return;
  return {
    mode: section === 'coders' ? 'code' : 'chat',
    conversation: {
      type: section === 'agent-chats' ? 'chat' : 'agent_session',
      id: conversationId,
    },
  };
}

export function agentsRouteSegments(id: string): string[] | undefined {
  if (!parseAgentsRoute(id)) return;
  return id.slice(PREFIX.length).split('~');
}

export function agentsRouteFromSegments(
  section: string,
  id: string
): string | undefined {
  const componentId = `${PREFIX}${section}~${id}`;
  return parseAgentsRoute(componentId) ? componentId : undefined;
}

import { ROUTER_BASE } from '@app/lib/constants/routerBase';
import { modeForKind, systemBotKind } from './agent-kind';
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

/** Router-relative path, e.g. `/agents/<id>`. */
export function agentsRoutePath(route: AgentsRoute): string {
  return `/${agentsRouteSegments(agentsRouteId(route))!.join('/')}`;
}

/** Absolute app href so session rows can be opened, copied, or middle-clicked. */
export function agentsRouteHref(route: AgentsRoute): string {
  const path = agentsRoutePath(route);
  return ROUTER_BASE === '/' ? path : `${ROUTER_BASE}${path}`;
}

/** Workspace route for an agent session when only the bot id is known. */
export function agentsRouteForSession(id: string, botId?: string): AgentsRoute {
  return {
    mode: modeForKind(systemBotKind(botId) ?? 'agent'),
    conversation: { type: 'agent_session', id },
  };
}

export function agentsSessionSplitContent(id: string, botId?: string) {
  return {
    type: 'component' as const,
    id: agentsRouteId(agentsRouteForSession(id, botId)),
  };
}

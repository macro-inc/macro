import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import { describe, expect, it } from 'vitest';
import {
  type AgentsRoute,
  agentsRouteForSession,
  agentsRouteFromSegments,
  agentsRouteHref,
  agentsRouteId,
  agentsRoutePath,
  agentsRouteSegments,
  agentsSessionSplitContent,
  parseAgentsRoute,
} from './route';

describe('Agents workspace routes', () => {
  it.each<[AgentsRoute, string]>([
    [
      {
        mode: 'chat',
        conversation: { type: 'agent_session', id: 'session-1' },
      },
      'agents',
    ],
    [
      {
        mode: 'code',
        conversation: { type: 'agent_session', id: 'session-2' },
      },
      'coders',
    ],
    [
      { mode: 'chat', conversation: { type: 'chat', id: 'chat-1' } },
      'agent-chats',
    ],
  ])('round trips the selected conversation and mode: %j', (route, section) => {
    const id = agentsRouteId(route);
    expect(parseAgentsRoute(id)).toEqual(route);
    expect(agentsRouteSegments(id)).toEqual([section, route.conversation.id]);
    expect(agentsRouteFromSegments(section, route.conversation.id)).toBe(id);
    expect(agentsRoutePath(route)).toBe(`/${section}/${route.conversation.id}`);
    expect(agentsRouteHref(route)).toMatch(
      new RegExp(`/(?:app/)?${section}/${route.conversation.id}$`)
    );
  });

  it('puts coding bots on /coders and everyone else on /agents', () => {
    expect(agentsRouteForSession('session-1', CURSOR_BOT_ID)).toEqual({
      mode: 'code',
      conversation: { type: 'agent_session', id: 'session-1' },
    });
    expect(agentsSessionSplitContent('session-2', 'chat-bot')).toEqual({
      type: 'component',
      id: agentsRouteId({
        mode: 'chat',
        conversation: { type: 'agent_session', id: 'session-2' },
      }),
    });
  });

  it('does not claim unrelated routes or malformed component identities', () => {
    expect(agentsRouteFromSegments('md', 'document-1')).toBeUndefined();
    expect(parseAgentsRoute('agents')).toBeUndefined();
    expect(parseAgentsRoute('agents-session~agents~')).toBeUndefined();
    expect(parseAgentsRoute('agents-session~agents~id~extra')).toBeUndefined();
  });
});

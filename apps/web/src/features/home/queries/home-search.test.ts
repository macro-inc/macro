import { describe, expect, it, vi } from 'vitest';
import { buildHomeSearchRequest } from './home-search';

// The soup barrel imports the websocket client modules, which open real
// sockets at module scope and reject under jsdom.
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const NIL = '00000000-0000-0000-0000-000000000000';

const context = {
  tab: 'signal' as const,
  facets: {},
  facetContext: { notificationSource: undefined as never },
  capabilities: {
    calendar: true,
    foreignEntities: true,
    notifiedSort: true,
    snippets: true,
  },
  userId: 'macro|alice@example.com',
};

const search = { query: 'roadmap', matchType: 'partial' as const };

describe('Home search channel threads', () => {
  it("searches the viewer's channel threads", () => {
    const { filters } = buildHomeSearchRequest(context, search).body;
    expect(filters?.channel_thread_filters).toEqual({
      participant_ids: ['macro|alice@example.com'],
    });
  });

  it('excludes channel threads before the viewer is known', () => {
    const { filters } = buildHomeSearchRequest(
      { ...context, userId: undefined },
      search
    ).body;
    expect(filters?.channel_thread_filters).toEqual({ thread_ids: [NIL] });
  });
});

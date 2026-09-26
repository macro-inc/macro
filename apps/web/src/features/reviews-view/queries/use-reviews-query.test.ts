import { describe, expect, it, vi } from 'vitest';
import { reviewsQueryBody } from './use-reviews-query';

// Soup query imports websocket clients that cannot connect in jsdom.
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

describe('Reviews Soup filter', () => {
  it.each(['all', 'authored'] as const)(
    'requests accessible GitHub pull requests for %s',
    (scope) => {
      expect(reviewsQueryBody(scope).fef).toEqual({
        l: { fes: 'github_pull_request' },
      });
    }
  );

  it('filters Involving me by the backend participant predicate', () => {
    expect(reviewsQueryBody('involving').fef).toEqual({
      '&': [{ l: { fes: 'github_pull_request' } }, { l: 'me' }],
    });
  });
});

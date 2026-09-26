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

const unfiltered = { repositoryIds: [], authorIds: [] };

describe('Reviews Soup filter', () => {
  it.each(['all', 'authored'] as const)(
    'requests accessible GitHub pull requests for %s',
    (scope) => {
      expect(reviewsQueryBody({ scope, ...unfiltered }).fef).toEqual({
        l: { fes: 'github_pull_request' },
      });
    }
  );

  it('filters Involving me by the backend participant predicate', () => {
    expect(reviewsQueryBody({ scope: 'involving', ...unfiltered }).fef).toEqual(
      {
        '&': [{ l: { fes: 'github_pull_request' } }, { l: 'me' }],
      }
    );
  });

  it('sends no pull request filter without repository or author filters', () => {
    expect(
      reviewsQueryBody({ scope: 'all', ...unfiltered }).ghprf
    ).toBeUndefined();
  });

  it('matches any selected repository and any selected author', () => {
    expect(
      reviewsQueryBody({
        scope: 'all',
        repositoryIds: ['99', '100'],
        authorIds: ['7'],
      }).ghprf
    ).toEqual({
      '&': [
        { '|': [{ l: { repo: 99 } }, { l: { repo: 100 } }] },
        { l: { au: '7' } },
      ],
    });
  });

  it("matches Authored by me against the viewer's GitHub id", () => {
    expect(
      reviewsQueryBody({
        scope: 'authored',
        ...unfiltered,
        viewerGithubUserId: '42',
      }).ghprf
    ).toEqual({ l: { au: '42' } });
  });
});

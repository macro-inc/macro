import { describe, expect, it, vi } from 'vitest';
import { EMPTY_REVIEWS_FILTERS } from '../reviews-types';
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

const unfiltered = { filters: EMPTY_REVIEWS_FILTERS };

describe('Reviews Soup filter', () => {
  it.each(['all', 'authored', 'assigned', 'review_requests'] as const)(
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
        filters: {
          ...EMPTY_REVIEWS_FILTERS,
          repository: ['99', '100'],
          author: ['7'],
        },
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

  it.each([
    ['assigned', { as: '42' }],
    ['review_requests', { rr: '42' }],
  ] as const)("matches %s against the viewer's GitHub id", (scope, literal) => {
    expect(
      reviewsQueryBody({ scope, ...unfiltered, viewerGithubUserId: '42' }).ghprf
    ).toEqual({ l: literal });
  });

  it('matches any selected assignee and any selected label', () => {
    expect(
      reviewsQueryBody({
        scope: 'all',
        filters: {
          ...EMPTY_REVIEWS_FILTERS,
          assignee: ['7'],
          label: ['bug', 'docs'],
        },
      }).ghprf
    ).toEqual({
      '&': [
        { l: { as: '7' } },
        { '|': [{ l: { lbl: 'bug' } }, { l: { lbl: 'docs' } }] },
      ],
    });
  });

  it('matches any selected review filter, including the viewer ones', () => {
    expect(
      reviewsQueryBody({
        scope: 'all',
        filters: {
          ...EMPTY_REVIEWS_FILTERS,
          review: ['approved', 'not_reviewed_by_me', 'awaiting_my_review'],
        },
        viewerGithubUserId: '42',
      }).ghprf
    ).toEqual({
      '|': [
        { l: { rs: 'approved' } },
        {
          '|': [{ '!': { l: { rb: '42' } } }, { l: { rr: '42' } }],
        },
      ],
    });
  });

  it('drops viewer review filters without a GitHub identity', () => {
    expect(
      reviewsQueryBody({
        scope: 'all',
        filters: { ...EMPTY_REVIEWS_FILTERS, review: ['reviewed_by_me'] },
      }).ghprf
    ).toBeUndefined();
  });
});

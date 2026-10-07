import { describe, expect, it, vi } from 'vitest';
import { reviewsStatusTabSelection } from '../core/reviews-status';
import { EMPTY_REVIEWS_FILTERS } from '../reviews-types';
import { reviewsQueryBody } from './use-reviews-query';

vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => undefined,
}));
vi.mock('@entity', () => ({ isGithubPrEntity: () => true }));
vi.mock('@queries/soup/items', () => ({ useSoupAstItemsQuery: () => ({}) }));
vi.mock('@app/features/soup/entity-notifications', () => ({
  withEntityNotifications: (entity: unknown) => entity,
}));

describe('reviewsQueryBody status filters', () => {
  it('leaves all statuses available by default', () => {
    const body = reviewsQueryBody({
      scope: 'all',
      filters: EMPTY_REVIEWS_FILTERS,
    });
    expect(body.fef).toEqual({ l: { fes: 'github_pull_request' } });
    expect(body.ghprf).toBeUndefined();
  });

  it('ORs selected statuses and ANDs other groups on the server', () => {
    const body = reviewsQueryBody({
      scope: 'all',
      filters: {
        ...EMPTY_REVIEWS_FILTERS,
        status: ['open', 'merged'],
        repository: ['42'],
        author: ['7'],
      },
    });
    expect(body.ghprf).toEqual({
      '&': [
        { '|': [{ l: { st: 'open' } }, { l: { st: 'merged' } }] },
        {
          '&': [{ l: { repo: 42 } }, { l: { au: '7' } }],
        },
      ],
    });
  });

  it('includes merged PRs in the Closed tab on the server', () => {
    const body = reviewsQueryBody({
      scope: 'all',
      filters: {
        ...EMPTY_REVIEWS_FILTERS,
        status: reviewsStatusTabSelection('closed'),
      },
    });
    expect(body.ghprf).toEqual({
      '|': [{ l: { st: 'closed' } }, { l: { st: 'merged' } }],
    });
  });

  it('filters a single status without requiring a GitHub identity', () => {
    const body = reviewsQueryBody({
      scope: 'all',
      filters: { ...EMPTY_REVIEWS_FILTERS, status: ['closed'] },
    });
    expect(body.ghprf).toEqual({ l: { st: 'closed' } });
  });
});

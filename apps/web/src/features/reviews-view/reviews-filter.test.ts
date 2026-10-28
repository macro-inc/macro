import type { PrLinks } from '@block-pr/data/pr-links';
import type { GithubPullRequestEntity } from '@entity';
import { describe, expect, it } from 'vitest';
import {
  applyReviewLinks,
  effectiveReviewsFilters,
  UNKNOWN_ORIGIN,
} from './reviews-filter';
import {
  EMPTY_REVIEWS_FILTERS,
  type ReviewsFilterSelection,
  type ReviewsSortId,
} from './reviews-types';

describe('effective review filters', () => {
  const saved: ReviewsFilterSelection = {
    ...EMPTY_REVIEWS_FILTERS,
    repository: ['42'],
    review: ['awaiting_my_review'],
  };

  it('excludes viewer-specific selections without changing saved filters', () => {
    const active = effectiveReviewsFilters(saved, false);
    expect(active.review).toEqual([]);
    expect(active.repository).toEqual(['42']);
    expect(saved.review).toEqual(['awaiting_my_review']);
  });

  it('restores saved selections when the GitHub identity returns', () => {
    effectiveReviewsFilters(saved, false);
    expect(effectiveReviewsFilters(saved, true)).toBe(saved);
  });

  it('has no active selections when only unavailable review filters are saved', () => {
    const active = effectiveReviewsFilters(
      { ...EMPTY_REVIEWS_FILTERS, review: ['reviewed_by_me'] },
      false
    );
    expect(Object.values(active).flat()).toEqual([]);
  });
});

describe('review link filters and priority sort', () => {
  const review = (id: string) =>
    ({ id, metadata: { labels: [] } }) as unknown as GithubPullRequestEntity;
  const links = (overrides: Partial<PrLinks>): PrLinks => ({
    sessions: [],
    tasks: [],
    channelIds: [],
    channelOrigins: [],
    companyIds: [],
    priority: { id: 'none' },
    ...overrides,
  });
  const byId: Record<string, PrLinks | undefined> = {
    low: links({ priority: { id: 'low', source: 'label' } }),
    urgent: links({
      priority: { id: 'urgent', source: 'task', taskId: 't' },
      companyIds: ['acme'],
    }),
    none: links({
      sessions: [{ id: 's', source: 'agent' }],
      origin: { tool: 'claude', signal: 'agent-session', sessionId: 's' },
    }),
    pending: undefined,
  };
  const reviews = ['low', 'pending', 'none', 'urgent'].map(review);
  const linksFor = (entity: GithubPullRequestEntity) => byId[entity.id];
  const ids = (list: GithubPullRequestEntity[]) =>
    list.map((entity) => entity.id);

  it('sorts most urgent first and keeps the server order within a priority', () => {
    expect(
      ids(
        applyReviewLinks(reviews, linksFor, EMPTY_REVIEWS_FILTERS, 'priority')
      )
    ).toEqual(['urgent', 'low', 'pending', 'none']);
  });

  it('keeps the server order for rows without timestamps', () => {
    expect(
      ids(applyReviewLinks(reviews, linksFor, EMPTY_REVIEWS_FILTERS, 'newest'))
    ).toEqual(['low', 'pending', 'none', 'urgent']);
  });

  describe('date sorts', () => {
    const dated = (id: string, updatedAt: string, createdAt: string) =>
      ({
        id,
        updatedAt,
        createdAt,
        metadata: { labels: [] },
      }) as unknown as GithubPullRequestEntity;
    // `live` was updated after the page loaded, so it arrives in its old slot.
    const fetched = [
      dated('a', '2026-10-20T10:00:00Z', '2026-10-01T00:00:00Z'),
      dated('live', '2026-10-21T16:30:00Z', '2026-10-02T00:00:00Z'),
      dated('b', '2026-10-19T10:00:00Z', '2026-10-03T00:00:00Z'),
    ];
    const sorted = (sort: ReviewsSortId) =>
      ids(applyReviewLinks(fetched, linksFor, EMPTY_REVIEWS_FILTERS, sort));

    it('orders rows by the timestamp they are sorted on', () => {
      expect(sorted('recently_updated')).toEqual(['live', 'a', 'b']);
      expect(sorted('least_recently_updated')).toEqual(['b', 'a', 'live']);
      expect(sorted('newest')).toEqual(['b', 'live', 'a']);
      expect(sorted('oldest')).toEqual(['a', 'live', 'b']);
    });

    it('orders equal priorities by recency', () => {
      expect(sorted('priority')).toEqual(['live', 'a', 'b']);
    });
  });

  it('matches any selected priority or link and holds back unloaded rows', () => {
    expect(
      ids(
        applyReviewLinks(
          reviews,
          linksFor,
          { ...EMPTY_REVIEWS_FILTERS, priority: ['urgent', 'none'] },
          'recently_updated'
        )
      )
    ).toEqual(['none', 'urgent']);
    expect(
      ids(
        applyReviewLinks(
          reviews,
          linksFor,
          { ...EMPTY_REVIEWS_FILTERS, linked: ['agent', 'customer'] },
          'recently_updated'
        )
      )
    ).toEqual(['none', 'urgent']);
  });

  it('matches the tool a pull request was started from, or unknown', () => {
    expect(
      ids(
        applyReviewLinks(
          reviews,
          linksFor,
          { ...EMPTY_REVIEWS_FILTERS, origin: ['claude'] },
          'recently_updated'
        )
      )
    ).toEqual(['none']);
    expect(
      ids(
        applyReviewLinks(
          reviews,
          linksFor,
          { ...EMPTY_REVIEWS_FILTERS, origin: [UNKNOWN_ORIGIN] },
          'recently_updated'
        )
      )
    ).toEqual(['low', 'urgent']);
  });
});

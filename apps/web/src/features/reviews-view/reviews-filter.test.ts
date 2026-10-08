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

  it('leaves the order alone for other sorts', () => {
    expect(
      ids(applyReviewLinks(reviews, linksFor, EMPTY_REVIEWS_FILTERS, 'newest'))
    ).toEqual(['low', 'pending', 'none', 'urgent']);
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

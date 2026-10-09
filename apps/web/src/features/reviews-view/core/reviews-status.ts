import type {
  ReviewsStatusFilterId,
  ReviewsStatusTabId,
} from '../reviews-types';

/** Only highlight a tab when the menu selection matches the whole preset. */
export function reviewsStatusTab(
  statuses: readonly string[]
): ReviewsStatusTabId | undefined {
  if (statuses.length === 1 && statuses[0] === 'open') return 'open';
  if (
    statuses.length === 2 &&
    statuses.includes('closed') &&
    statuses.includes('merged')
  ) {
    return 'closed';
  }
  return undefined;
}

/** Keep the combined Closed preset visible, but hide custom multi-selections. */
export const showReviewsStatusTabs = (statuses: readonly string[]) =>
  statuses.length <= 1 || reviewsStatusTab(statuses) !== undefined;

const STATUS_TAB_SELECTIONS: Record<
  ReviewsStatusTabId,
  ReviewsStatusFilterId[]
> = {
  open: ['open'],
  closed: ['closed', 'merged'],
};

/** Closed includes merged PRs; menu choices remain independently selectable. */
export const reviewsStatusTabSelection = (
  tab: ReviewsStatusTabId
): ReviewsStatusFilterId[] => [...STATUS_TAB_SELECTIONS[tab]];

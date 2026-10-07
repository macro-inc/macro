export type ReviewsScope =
  | 'all'
  | 'authored'
  | 'assigned'
  | 'involving'
  | 'review_requests';
export type ReviewsSortId =
  | 'recently_updated'
  | 'least_recently_updated'
  | 'newest'
  | 'oldest';
/** Review filters, which match the viewer's GitHub user id. */
export type ReviewsReviewFilterId =
  | 'reviewed_by_me'
  | 'not_reviewed_by_me'
  | 'awaiting_my_review';
export type ReviewsStatusFilterId = 'open' | 'closed' | 'merged';
export type ReviewsStatusTabId = 'open' | 'closed';
export type ReviewsFilterId =
  | 'status'
  | 'repository'
  | 'author'
  | 'assignee'
  | 'label'
  | 'review';
/** Selected option ids per filter group; any option in a group matches. */
export type ReviewsFilterSelection = Record<ReviewsFilterId, readonly string[]>;

export const EMPTY_REVIEWS_FILTERS: ReviewsFilterSelection = {
  status: [],
  repository: [],
  author: [],
  assignee: [],
  label: [],
  review: [],
};

/** Default and reset state for the Reviews list. */
export const DEFAULT_REVIEWS_FILTERS: ReviewsFilterSelection = {
  ...EMPTY_REVIEWS_FILTERS,
  status: ['open'],
};

/** Sidebar order, which the tab hotkeys follow. */
export const REVIEWS_SCOPES: readonly ReviewsScope[] = [
  'all',
  'authored',
  'assigned',
  'involving',
  'review_requests',
];

/**
 * Scopes the backend matches against the viewer's GitHub user id, so they wait
 * for it. "Involves me" resolves the linked identity on the backend instead.
 */
export const scopeMatchesViewerGithubId = (scope: ReviewsScope) =>
  scope === 'authored' || scope === 'assigned' || scope === 'review_requests';

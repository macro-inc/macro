export type ReviewsScope =
  | 'all'
  | 'authored'
  | 'assigned'
  | 'involving'
  | 'review_requests';
export type ReviewsSortId =
  | 'priority'
  | 'recently_updated'
  | 'least_recently_updated'
  | 'newest'
  | 'oldest';
/** Review filters, which match the viewer's GitHub user id. */
export type ReviewsReviewFilterId =
  | 'reviewed_by_me'
  | 'not_reviewed_by_me'
  | 'awaiting_my_review';
export type ReviewsFilterId =
  | 'repository'
  | 'author'
  | 'assignee'
  | 'label'
  | 'review'
  | 'priority'
  | 'linked';
/** Selected option ids per filter group; any option in a group matches. */
export type ReviewsFilterSelection = Record<ReviewsFilterId, readonly string[]>;

export const EMPTY_REVIEWS_FILTERS: ReviewsFilterSelection = {
  repository: [],
  author: [],
  assignee: [],
  label: [],
  review: [],
  priority: [],
  linked: [],
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

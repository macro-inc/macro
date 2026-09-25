import { createListController } from '@app/components/list';
import type { GithubPullRequestEntity } from '@entity';
import type { Accessor } from 'solid-js';

export type ReviewActivationMetadata = { newSplit?: boolean };

/** Keep review focus and selection alive while a detail route replaces the list. */
export function createReviewsListController(
  items: Accessor<readonly GithubPullRequestEntity[]>,
  onOpen: (id: string, newSplit: boolean) => void
) {
  return createListController<
    GithubPullRequestEntity,
    ReviewActivationMetadata
  >({
    items,
    getKey: (review) => review.id,
    onActivate: ({ item, metadata }) =>
      onOpen(item.id, metadata?.newSplit === true),
  });
}

export type ReviewsListController = ReturnType<
  typeof createReviewsListController
>;

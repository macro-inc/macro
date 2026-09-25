import { PrStatusIcon } from '@block-pr/component/PrStatus';
import type { GithubPullRequestEntity } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { Button } from '@ui';
import { For, Match, Show, Suspense, Switch } from 'solid-js';
import type { useReviewsQuery } from '../queries/use-reviews-query';
import { filterReviews } from '../reviews-filter';
import type { ReviewsScope } from '../reviews-types';

export type ReviewsListProps = {
  source: ReturnType<typeof useReviewsQuery>;
  scope: ReviewsScope;
  authorLogin?: string;
  search: string;
  selectedRepositories: readonly string[];
  selectedAuthors: readonly string[];
  onOpen: (foreignEntityId: string, event: MouseEvent) => void;
};

function ReviewRow(props: {
  review: GithubPullRequestEntity;
  onOpen: ReviewsListProps['onOpen'];
}) {
  const repository = () =>
    `${props.review.metadata.owner}/${props.review.metadata.repo}`;

  return (
    <li class="mx-1">
      <button
        type="button"
        class="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-list-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        onClick={(event) => props.onOpen(props.review.id, event)}
        aria-label={`${props.review.metadata.name}, ${repository()}, ${props.review.metadata.status}`}
      >
        <PrStatusIcon
          status={props.review.metadata.status}
          class="size-4 shrink-0"
        />
        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="truncate text-sm font-medium text-ink">
            {props.review.metadata.name}
          </span>
          <span class="truncate text-xs text-ink-muted">
            {repository()} #{props.review.metadata.number}
          </span>
        </span>
        <span class="shrink-0 text-xs capitalize text-ink-muted">
          {props.review.metadata.status}
        </span>
      </button>
    </li>
  );
}

export function ReviewsList(props: ReviewsListProps) {
  const reviews = () =>
    filterReviews(props.source.reviews(), {
      scope: props.scope,
      authorLogin: props.authorLogin,
      search: props.search,
      repositories: props.selectedRepositories,
      authors: props.selectedAuthors,
    });
  const source = props.source;
  const loadMore = () => {
    if (source.isLoadingMore()) return;
    void source.loadMore();
  };

  return (
    <section aria-label="Reviews" class="flex size-full min-h-0 flex-col">
      <div class="shrink-0 border-b border-edge-muted px-4 py-3">
        <h2 class="text-sm font-semibold text-ink">
          {props.scope === 'authored' ? 'Authored by me' : 'Pull requests'}
        </h2>
      </div>
      <Suspense
        fallback={
          <div
            role="status"
            class="grid flex-1 place-items-center text-ink-muted"
          >
            <SpinnerIcon
              aria-label="Loading reviews"
              class="size-5 animate-spin"
            />
          </div>
        }
      >
        <Switch>
          <Match when={source.isLoading()}>
            <div
              role="status"
              class="grid flex-1 place-items-center text-ink-muted"
            >
              <SpinnerIcon
                aria-label="Loading reviews"
                class="size-5 animate-spin"
              />
            </div>
          </Match>
          <Match when={source.error()}>
            <div
              role="alert"
              class="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-ink-muted"
            >
              <span>Reviews couldn’t be loaded.</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void source.retry()}
              >
                Try again
              </Button>
            </div>
          </Match>
          <Match when={true}>
            <div class="min-h-0 flex-1 overflow-auto">
              <Show
                when={reviews().length > 0}
                fallback={
                  <div class="grid min-h-32 place-items-center text-sm text-ink-muted">
                    {props.scope === 'authored' && !props.authorLogin
                      ? 'Connect GitHub to see pull requests you authored.'
                      : props.search.trim() ||
                          props.selectedRepositories.length ||
                          props.selectedAuthors.length
                        ? 'No pull requests match these filters.'
                        : 'No pull requests in this view.'}
                  </div>
                }
              >
                <ul aria-label="Pull requests" class="py-1">
                  <For each={reviews()}>
                    {(review) => (
                      <ReviewRow review={review} onOpen={props.onOpen} />
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={source.hasMore()}>
                <div class="flex justify-center p-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={source.isLoadingMore()}
                    onClick={loadMore}
                  >
                    <Show when={source.isLoadingMore()} fallback="Load More">
                      <SpinnerIcon class="size-3 animate-spin" /> Loading...
                    </Show>
                  </Button>
                </div>
              </Show>
            </div>
          </Match>
        </Switch>
      </Suspense>
    </section>
  );
}

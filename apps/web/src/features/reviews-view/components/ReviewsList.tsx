import {
  type GithubPullRequestEntity,
  ListEntity,
  ListLayoutProvider,
} from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { Button } from '@ui';
import { createSignal, For, Match, Show, Suspense, Switch } from 'solid-js';
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
  onOpen: (foreignEntityId: string, newSplit: boolean) => void;
};

function ReviewRow(props: {
  review: GithubPullRequestEntity;
  onOpen: ReviewsListProps['onOpen'];
}) {
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${props.review.metadata.name}, ${props.review.metadata.owner}/${props.review.metadata.repo}, ${props.review.metadata.status}`}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          props.onOpen(props.review.id, false);
        }}
        class="outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ListEntity
          entity={props.review}
          hideCheckbox
          onClick={(event) => props.onOpen(props.review.id, event.shiftKey)}
        />
      </div>
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
  const [listElement, setListElement] = createSignal<HTMLDivElement>();
  const loadMore = () => {
    if (source.isLoadingMore()) return;
    void source.loadMore();
  };

  return (
    <section aria-label="Reviews" class="flex size-full min-h-0 flex-col">
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
            <div ref={setListElement} class="min-h-0 flex-1 overflow-auto">
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
                <ListLayoutProvider ref={listElement}>
                  <ul aria-label="Pull requests" class="py-1">
                    <For each={reviews()}>
                      {(review) => (
                        <ReviewRow review={review} onOpen={props.onOpen} />
                      )}
                    </For>
                  </ul>
                </ListLayoutProvider>
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

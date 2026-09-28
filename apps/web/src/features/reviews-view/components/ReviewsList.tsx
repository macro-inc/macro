import { useListInteractions } from '@app/components/list';
import {
  makeCopyLinkAction,
  makeFavoriteAction,
  toEntityActionListState,
  useEntityActionHotkeys,
} from '@app/features/next-soup/actions';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useInfiniteScrollSentinel } from '@companies/Company/use-infinite-scroll-sentinel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import {
  EntitySelectionToolbar,
  type GithubPullRequestEntity,
  ListEntity,
  ListLayoutProvider,
} from '@entity';
import { ContextMenu } from '@kobalte/core/context-menu';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import SplitIcon from '@phosphor/columns.svg';
import CopyIcon from '@phosphor/copy.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import StarIcon from '@phosphor/star.svg';
import type { GithubLinkStatus } from '@queries/auth/github-link';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button } from '@ui';
import {
  createEffect,
  createSignal,
  type JSX,
  Match,
  onCleanup,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import type { ReviewsListController } from '../primitives/create-reviews-list-controller';
import type { useReviewsQuery } from '../queries/use-reviews-query';
import { isAuthoredBy } from '../reviews-filter';
import type { ReviewsScope } from '../reviews-types';
import { ReviewsEmptyState } from './ReviewsEmptyState';

export type ReviewsListProps = {
  list: ReviewsListController;
  source: ReturnType<typeof useReviewsQuery>;
  scope: ReviewsScope;
  authorLogin?: string;
  authorId?: string;
  viewerName?: string;
  githubIdentityLoading: boolean;
  githubAccountStatus?: GithubLinkStatus | 'error';
  search: string;
  selectedRepositories: readonly string[];
  selectedAuthors: readonly string[];
  onClearSearch: () => void;
  onClearFilters: () => void;
  onOpen: (foreignEntityId: string, newSplit: boolean) => void;
};

const copyLink = makeCopyLinkAction();

function ReviewListElement(props: JSX.HTMLAttributes<HTMLUListElement>) {
  return <ul {...props} aria-label="Pull requests" />;
}

function ReviewRow(props: {
  review: GithubPullRequestEntity;
  authorDisplayName?: string;
  checked: boolean;
  onChecked: (checked: boolean, shiftKey: boolean) => void;
  favoriteAction: ReturnType<typeof makeFavoriteAction>;
  onOpen: ReviewsListProps['onOpen'];
  onActivate: (newSplit: boolean) => void;
  onClick: (event: MouseEvent) => void;
  onFocus: () => void;
}) {
  return (
    <ContextMenu>
      <ContextMenu.Trigger
        as="div"
        class="w-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
        role="button"
        tabIndex={0}
        aria-label={`${props.review.metadata.name}, ${props.review.metadata.owner}/${props.review.metadata.repo}`}
        onFocusIn={props.onFocus}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          props.onActivate(event.shiftKey);
        }}
      >
        <ListEntity
          entity={props.review}
          authorDisplayName={props.authorDisplayName}
          checked={props.checked}
          onChecked={props.onChecked}
          onClick={props.onClick}
        />
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenuContent class="w-56 text-xs text-ink-muted">
          <MenuItem
            icon={SplitIcon}
            text="Open in new split"
            disabled={!globalSplitManager()?.canAppendSplit()}
            onClick={() => {
              if (globalSplitManager()?.canAppendSplit())
                props.onOpen(props.review.id, true);
            }}
          />
          <MenuItem
            icon={StarIcon}
            text={
              props.favoriteAction.isFavorited(props.review)
                ? 'Remove from favorites'
                : 'Add to favorites'
            }
            onClick={() => void props.favoriteAction.execute([props.review])}
          />
          <MenuItem
            icon={CopyIcon}
            text="Copy link"
            onClick={() => void copyLink.execute([props.review])}
          />
          <MenuItem
            icon={ArrowSquareOutIcon}
            text="Open on GitHub"
            onClick={() =>
              window.open(
                props.review.metadata.url,
                '_blank',
                'noopener,noreferrer'
              )
            }
          />
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}

export function ReviewsList(props: ReviewsListProps) {
  const panel = useSplitPanelOrThrow();
  const favoriteAction = makeFavoriteAction();
  const source = props.source;
  const list = props.list;
  const reviews = list.items.all;
  const selectedReviews = list.selection.items;
  const missingIdentity = () =>
    props.scope === 'authored' && !props.authorLogin && !props.authorId;
  const [listElement, setListElement] = createSignal<HTMLDivElement>();
  const [sentinel, setSentinel] = createSignal<HTMLDivElement>();
  const listSize = createElementSize(listElement);
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  const listInteractions = useListInteractions({
    controller: list,
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    scrollHandle: virtualizer,
    activation: {
      createMetadata: (intent) => ({ newSplit: intent === 'alternate' }),
      alternateDescription: 'Open in new split',
    },
  });
  const actionState = toEntityActionListState({
    controller: list,
    getEntity: (review) => review,
    onFocus: (target) => {
      if (target)
        virtualizer()?.scrollToIndex(target.index, { align: 'nearest' });
      listElement()?.focus();
    },
  });
  useEntityActionHotkeys({
    scopeId: panel.splitHotkeyScope,
    list: actionState,
    selectedEntities: list.selection.items,
    focusedEntity: list.focus.item,
    restoreFocus: () => listElement()?.focus(),
    viewContext: () => ({ supportsMarkDone: false, senderBucket: undefined }),
    splitHandle: panel.handle,
    condition: panel.isPanelActive,
  });
  let active = true;
  onCleanup(() => (active = false));
  let loadingNextPage = false;
  const loadMore = async () => {
    if (loadingNextPage || source.isLoadingMore() || !source.hasMore()) return;
    loadingNextPage = true;
    try {
      await source.loadMore();
    } catch {
      // The query owns the page error and exposes a manual retry below the list.
    } finally {
      loadingNextPage = false;
    }
  };
  const checkNearEnd = () => {
    const element = listElement();
    if (
      !active ||
      !element ||
      missingIdentity() ||
      source.isLoading() ||
      source.isLoadingMore() ||
      source.pageError() ||
      !source.hasMore() ||
      (props.scope === 'authored' && props.githubIdentityLoading)
    )
      return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 320)
      void loadMore();
  };

  useInfiniteScrollSentinel({
    sentinel,
    hasNextPage: () =>
      source.hasMore() && !source.pageError() && !missingIdentity(),
    isFetchingNextPage: source.isLoadingMore,
    fetchNextPage: () => void loadMore(),
    rootMargin: '320px',
  });

  // The visible rows can be sparser than the fetched pages after local filters.
  // Measure the scroll area after rendering each page and keep fetching until
  // the viewport fills, a result is reachable, or pagination ends.
  createEffect(() => {
    reviews().length;
    listSize.height;
    source.isLoadingMore();
    source.hasMore();
    source.pageError();
    listElement();
    queueMicrotask(checkNearEnd);
  });

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
          <Match
            when={
              source.isLoading() ||
              (props.scope === 'authored' && props.githubIdentityLoading)
            }
          >
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
            <div
              ref={setListElement}
              role="group"
              aria-label="Pull requests"
              tabIndex={0}
              class="min-h-0 flex-1 overflow-auto"
            >
              <Show
                when={reviews().length > 0}
                fallback={
                  <Show
                    when={
                      source.hasMore() &&
                      !source.pageError() &&
                      !missingIdentity()
                    }
                    fallback={
                      <Show
                        when={source.pageError() && !missingIdentity()}
                        fallback={
                          <ReviewsEmptyState
                            scope={props.scope}
                            search={props.search}
                            hasFilters={
                              props.selectedRepositories.length > 0 ||
                              props.selectedAuthors.length > 0
                            }
                            hasAuthorIdentity={Boolean(
                              props.authorLogin || props.authorId
                            )}
                            githubAccountStatus={props.githubAccountStatus}
                            onClearSearch={props.onClearSearch}
                            onClearFilters={props.onClearFilters}
                          />
                        }
                      >
                        <div
                          role="alert"
                          class="grid min-h-32 place-items-center text-sm text-ink-muted"
                        >
                          More pull requests couldn’t be loaded. Retry below.
                        </div>
                      </Show>
                    }
                  >
                    <div
                      role="status"
                      class="grid min-h-32 place-items-center text-sm text-ink-muted"
                    >
                      Searching more pull requests…
                    </div>
                  </Show>
                }
              >
                <ListLayoutProvider ref={listElement}>
                  <Virtualizer
                    as={ReviewListElement}
                    item="li"
                    data={reviews()}
                    scrollRef={listElement()}
                    ref={setVirtualizer}
                    keepMounted={
                      list.focus.index() >= 0 ? [list.focus.index()] : undefined
                    }
                    bufferSize={320}
                    itemSize={48}
                    onScroll={checkNearEnd}
                  >
                    {(review) => (
                      <ReviewRow
                        review={review}
                        checked={list.selection.isSelected(review.id)}
                        authorDisplayName={
                          isAuthoredBy(
                            review,
                            props.authorLogin,
                            props.authorId
                          )
                            ? props.viewerName
                            : undefined
                        }
                        favoriteAction={favoriteAction}
                        onOpen={props.onOpen}
                        onChecked={(checked, shiftKey) =>
                          listInteractions.selection.set(review.id, checked, {
                            range: shiftKey,
                          })
                        }
                        onFocus={() =>
                          list.focus.set(review.id, { reason: 'pointer' })
                        }
                        onClick={(event) => {
                          if (event.metaKey || event.ctrlKey) {
                            listInteractions.selection.toggle(review.id);
                            return;
                          }
                          list.activate.key(review.id, {
                            reason: 'pointer',
                            metadata: { newSplit: event.shiftKey },
                          });
                        }}
                        onActivate={(newSplit) =>
                          list.activate.key(review.id, {
                            reason: 'keyboard',
                            metadata: { newSplit },
                          })
                        }
                      />
                    )}
                  </Virtualizer>
                </ListLayoutProvider>
              </Show>
              <Show
                when={
                  source.hasMore() && !source.pageError() && !missingIdentity()
                }
              >
                <div ref={setSentinel} aria-hidden="true" class="h-px" />
              </Show>
              <Show
                when={
                  !missingIdentity() && (source.hasMore() || source.pageError())
                }
              >
                <div class="flex justify-center p-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={source.isLoadingMore()}
                    onClick={() =>
                      void (source.hasMore() ? loadMore() : source.retry())
                    }
                  >
                    <Show
                      when={source.isLoadingMore()}
                      fallback={
                        source.pageError()
                          ? source.hasMore()
                            ? 'Retry loading more'
                            : 'Retry loading'
                          : 'Load more'
                      }
                    >
                      <SpinnerIcon class="size-3 animate-spin" /> Loading…
                    </Show>
                  </Button>
                </div>
              </Show>
            </div>
          </Match>
        </Switch>
        <Show when={selectedReviews().length > 0}>
          <EntitySelectionToolbar
            selected={selectedReviews()}
            onClear={listInteractions.selection.clear}
            analyticsSource="reviews"
          />
        </Show>
      </Suspense>
    </section>
  );
}

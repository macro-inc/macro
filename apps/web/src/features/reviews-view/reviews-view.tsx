import {
  SearchBar,
  useViewControlHotkeys,
  useViewShell,
  ViewBreadcrumbs,
  ViewShell,
} from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { ViewCreateMenu } from '@app/features/command/view-create-menu';
import {
  createSearchParams,
  SplitRouter,
  useNavigate,
  useParams,
} from '@app/lib/split-router';
import { reviewsPrRoute, reviewsSplitRoute } from '@app/routes/routes';
import { PR_ORIGIN_TOOLS } from '@block-pr/data/pr-origin';
import {
  prLinksTarget,
  usePrLinksQuery,
} from '@block-pr/queries/pr-links-query';
import { type PillTabItem, PillTabs } from '@components/app/mobile/PillTabs';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { useUserContext } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type GithubPullRequestEntity,
  ListEntityMetadataQueryProvider,
} from '@entity';
import { GithubLabelPill } from '@entity/components/GithubLabelPill';
import { useGithubLinkStatusQuery } from '@queries/auth/github-link';
import { makePersisted } from '@solid-primitives/storage';
import { Button } from '@ui';
import {
  createMemo,
  createRenderEffect,
  createSignal,
  type JSX,
  Match,
  onMount,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { ReviewsBoard } from './components/ReviewsBoard';
import {
  activeReviewsFilterCount,
  ReviewsControls,
  ReviewsFilterDrawer,
} from './components/ReviewsControls';
import { ReviewsList } from './components/ReviewsList';
import { ReviewsSidebar } from './components/ReviewsSidebar';
import { ReviewsStatusTabs } from './components/ReviewsStatusTabs';
import {
  reviewsStatusTab,
  reviewsStatusTabSelection,
  showReviewsStatusTabs,
} from './core/reviews-status';
import { createReviewsListController } from './primitives/create-reviews-list-controller';
import { useReviewsFacetsQuery } from './queries/use-reviews-facets-query';
import { useReviewsMergeabilityQuery } from './queries/use-reviews-mergeability-query';
import { useReviewsQuery } from './queries/use-reviews-query';
import {
  applyReviewLinks,
  effectiveReviewsFilters,
  hasLinkFilters,
  searchReviews,
} from './reviews-filter';
import { reviewsHostedContent } from './reviews-hosted-content';
import { reviewsTabSearch, reviewsTabSearchCodec } from './reviews-tab-search';
import {
  DEFAULT_REVIEWS_FILTERS,
  REVIEWS_SCOPES,
  type ReviewsFilterId,
  type ReviewsFilterSelection,
  type ReviewsLayout,
  type ReviewsScope,
  type ReviewsSortId,
  type ReviewsStatusTabId,
  scopeMatchesViewerGithubId,
} from './reviews-types';
import { ReviewsListTopBar } from './views/ReviewsListTopBar';

const REVIEW_SCOPE_TITLES: Record<ReviewsScope, string> = {
  all: 'Pull requests',
  authored: 'Authored by me',
  assigned: 'Assigned to me',
  involving: 'Involves me',
  review_requests: 'Review requests',
};
const REVIEW_SCOPE_TABS: PillTabItem<ReviewsScope>[] = REVIEWS_SCOPES.map(
  (scope) => ({ value: scope, label: REVIEW_SCOPE_TITLES[scope] })
);
/** The board's status filter: open pull requests on their way, and merged ones. */
const BOARD_STATUSES = ['open', 'merged'];

/** The status toggle above the list, for touch layouts and a hidden sidebar. */
function ReviewsHeaderStatusTabs(props: { children: JSX.Element }) {
  const shell = useViewShell();
  return (
    <Show
      when={
        isTouchDevice() ||
        shell.breakpoints.narrow?.() ||
        shell.aside.isCollapsed()
      }
    >
      <div class="mt-3 min-w-0 overflow-x-auto">{props.children}</div>
    </Show>
  );
}

function ReviewsRoot() {
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  createRenderEffect(() =>
    panel.handle.updateMeta?.({ splitPanelLayout: 'composable' })
  );
  const navigate = useNavigate();
  const params = useParams<{ foreignEntityId?: string }>();
  const [tabSearch] = createSearchParams(reviewsTabSearch);
  const scope = (): ReviewsScope => tabSearch.tab;
  const scopeTitle = () => REVIEW_SCOPE_TITLES[scope()];
  const [search, setSearch] = createSignal('');
  const [reviewsLayout, setReviewsLayout] = makePersisted(
    createSignal<ReviewsLayout>('list'),
    { name: 'reviews-layout' }
  );
  const boardVisible = () => reviewsLayout() === 'board' && !isTouchDevice();
  const [sort, setSort] = createSignal<ReviewsSortId>('recently_updated');
  const [filters, setFilters] = createSignal<ReviewsFilterSelection>(
    DEFAULT_REVIEWS_FILTERS
  );
  const listVisible = () => !params.foreignEntityId;
  let focusSearch: (() => void) | undefined;
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () => panel.isPanelActive() && listVisible() && !isTouchDevice(),
    search: {
      description: 'Search reviews',
      run: () => {
        focusSearch?.();
        return true;
      },
    },
  });
  const githubLink = useGithubLinkStatusQuery({ enabled: listVisible });
  const viewer = useUserContext();
  const authorLogin = () =>
    githubLink.isPending ? undefined : githubLink.data?.username;
  const authorId = () =>
    githubLink.isPending ? undefined : githubLink.data?.userId;
  const activeFilters = () => {
    const effective = effectiveReviewsFilters(filters(), Boolean(authorId()));
    // The board lays pull requests out by status itself.
    return boardVisible()
      ? { ...effective, status: BOARD_STATUSES }
      : effective;
  };
  const listEnabled = () =>
    listVisible() &&
    (!scopeMatchesViewerGithubId(scope()) || Boolean(authorId()));
  const source = useReviewsQuery(
    sort,
    () => ({
      scope: scope(),
      filters: activeFilters(),
      viewerGithubUserId: authorId(),
    }),
    listEnabled
  );
  const facets = useReviewsFacetsQuery();
  const changeFilter = (
    group: ReviewsFilterId,
    id: string,
    selected: boolean
  ) =>
    setFilters((current) => {
      const ids = current[group];
      if (selected === ids.includes(id)) return current;
      return {
        ...current,
        [group]: selected ? [...ids, id] : ids.filter((value) => value !== id),
      };
    });
  const clearFilters = () => setFilters(DEFAULT_REVIEWS_FILTERS);
  const statusTab = () => reviewsStatusTab(filters().status);
  const selectStatusTab = (status: ReviewsStatusTabId) =>
    setFilters((current) => ({
      ...current,
      status: reviewsStatusTabSelection(status),
    }));
  const statusToggle = () =>
    !boardVisible() && showReviewsStatusTabs(filters().status)
      ? { value: statusTab(), onChange: selectStatusTab }
      : undefined;
  const clearSearch = () => setSearch('');
  const searchForTab = (tab: ReviewsScope) => ({
    [reviewsTabSearch.namespace]: reviewsTabSearchCodec.serialize({ tab }),
  });
  const openList = () => {
    fireAndForget(
      navigate(
        { route: reviewsSplitRoute, params: {} },
        { search: searchForTab(scope()) }
      ),
      'reviews-view'
    );
  };
  const selectScope = (next: ReviewsScope) =>
    navigate(
      { route: reviewsSplitRoute, params: {} },
      { search: searchForTab(next) }
    );
  const openReview = (foreignEntityId: string, newSplit: boolean) => {
    if (newSplit) {
      const tabSearchParams = reviewsTabSearchCodec.serialize({ tab: scope() });
      const content = reviewsHostedContent(
        { type: 'pr', id: foreignEntityId },
        tabSearchParams
          ? { [reviewsTabSearch.namespace]: tabSearchParams }
          : undefined
      );
      if (content)
        layout.openWithSplit(content, {
          preferNewSplit: true,
          // List and detail share the Reviews shell component identity.
          allowDuplicate: true,
        });
      return;
    }
    fireAndForget(
      navigate(
        { route: reviewsPrRoute, params: { foreignEntityId } },
        { search: searchForTab(scope()) }
      ),
      'reviews-view'
    );
  };
  // Links load for every fetched row, not just the searched ones, so the
  // per-page cache entries stay stable while the search changes.
  const links = usePrLinksQuery(() =>
    source.reviews().map((review) => prLinksTarget(review.metadata))
  );
  const linksFor = (review: GithubPullRequestEntity) =>
    links.linksFor(prLinksTarget(review.metadata).url);
  const reviews = createMemo(() =>
    applyReviewLinks(
      searchReviews(source.reviews(), search()),
      linksFor,
      activeFilters(),
      sort()
    )
  );
  // Link filters cannot match rows before their links arrive, so an empty
  // result waits for them instead of claiming nothing matches.
  // A failed link batch can hide every row under a link filter, so the list
  // then reports it with a retry instead of an empty result.
  const linkFilterFailed = () =>
    hasLinkFilters(activeFilters()) && links.isError();
  const listSource = {
    ...source,
    isLoading: () =>
      source.isLoading() ||
      (hasLinkFilters(activeFilters()) &&
        links.isLoading() &&
        reviews().length === 0),
    error: () =>
      source.error() ??
      (linkFilterFailed() && reviews().length === 0
        ? new Error('Pull request links couldn’t be loaded')
        : undefined),
    retry: () => {
      if (links.isError()) fireAndForget(links.retry(), 'reviews-view');
      return source.retry();
    },
  };
  const openLink = (content: SplitContent, newSplit: boolean) =>
    layout.openWithSplit(content, { preferNewSplit: newSplit });
  const listController = createReviewsListController(reviews, openReview);
  // Conflicts are read live, and only for the open pull requests on the board.
  // Like links, they load for every fetched row so search keeps the cache.
  const mergeability = useReviewsMergeabilityQuery(
    () =>
      boardVisible()
        ? source
            .reviews()
            .map((review) => review.metadata)
            .filter((pullRequest) => pullRequest.status === 'open')
        : [],
    boardVisible
  );
  const loadMore = async () => {
    if (source.isLoadingMore() || !source.hasMore()) return;
    try {
      await source.loadMore();
    } catch {
      // The query owns the page error; the board keeps its Load more button.
    }
  };
  // Tools the loaded pull requests were started from, in the filter menu's order.
  const agents = createMemo(() => {
    const found = new Set(
      source.reviews().flatMap((review) => linksFor(review)?.origin?.tool ?? [])
    );
    return PR_ORIGIN_TOOLS.filter((tool) => found.has(tool));
  });
  const selectAgents = (tools: string[]) => {
    setFilters((current) => ({ ...current, origin: tools }));
    if (!listVisible()) openList();
  };
  const selectLabels = (labels: string[]) => {
    setFilters((current) => ({ ...current, label: labels }));
    if (!listVisible()) openList();
  };
  const controls = () => ({
    sort: sort(),
    onSortChange: setSort,
    repositories: facets.repositories(),
    authors: facets.authors(),
    assignees: facets.assignees(),
    labels: facets.labels().map((label) => ({
      id: label.name,
      label: label.name,
      content: () => <GithubLabelPill name={label.name} color={label.color} />,
    })),
    hasGithubIdentity: Boolean(authorId()),
    // The board's columns are its status, so Status neither shows nor counts.
    hideStatus: boardVisible(),
    selected: boardVisible()
      ? { ...activeFilters(), status: [] }
      : activeFilters(),
    onFilterChange: changeFilter,
    onClearFilters: clearFilters,
  });
  const list = () => (
    <>
      <Show
        when={isTouchDevice()}
        fallback={
          <ListHeader
            title={
              <div class="flex min-w-0 items-center gap-3">
                <ViewBreadcrumbs.Outlet aria-label="Review location" />
                <Show when={statusToggle()}>
                  {(status) => (
                    <ReviewsStatusTabs
                      value={status().value}
                      onChange={status().onChange}
                      class="shrink-0"
                    />
                  )}
                </Show>
              </div>
            }
          >
            <ReviewsControls
              {...controls()}
              layout={reviewsLayout()}
              onLayoutChange={setReviewsLayout}
            />
            <ViewCreateMenu presentation="toolbar" />
            <ListHeaderSearch
              label="Search reviews"
              value={search()}
              onValueChange={setSearch}
              onEscape={() => panel.panelRef()?.focus()}
              registerFocus={(focus) => (focusSearch = focus)}
            />
          </ListHeader>
        }
      >
        <ReviewsListTopBar />
        <ViewShell.Header>
          <div class="flex min-w-0 flex-col gap-3">
            <div class="h-10 min-w-0 flex-1">
              <PillTabs
                scrollable
                leading={<ReviewsFilterDrawer {...controls()} />}
                items={REVIEW_SCOPE_TABS}
                value={scope()}
                onChange={selectScope}
              />
            </div>
            <SearchBar
              label="Search reviews"
              value={search()}
              onValueChange={setSearch}
              placeholder="Search reviews"
            />
          </div>
          {/* The sidebar holds the toggle; without one it sits above the list. */}
          <Show when={statusToggle()}>
            {(status) => (
              <ReviewsHeaderStatusTabs>
                <ReviewsStatusTabs
                  value={status().value}
                  onChange={status().onChange}
                  class="h-auto max-w-sm"
                />
              </ReviewsHeaderStatusTabs>
            )}
          </Show>
        </ViewShell.Header>
      </Show>
      <ViewShell.Content>
        <Show
          when={boardVisible()}
          fallback={
            <ReviewsList
              list={listController}
              source={listSource}
              links={{
                linksFor,
                companyName: links.companyName,
                onOpen: openLink,
              }}
              scope={scope()}
              sort={sort()}
              authorLogin={authorLogin()}
              authorId={authorId()}
              viewerName={viewer.userInfo()?.name ?? undefined}
              githubIdentityLoading={githubLink.isPending}
              githubAccountStatus={
                githubLink.isError
                  ? 'error'
                  : githubLink.isPending
                    ? undefined
                    : githubLink.data?.status
              }
              search={search()}
              hasFilters={
                activeReviewsFilterCount(activeFilters()) >
                (statusTab() === 'open' ? 1 : 0)
              }
              onClearFilters={clearFilters}
              onClearSearch={clearSearch}
              onOpen={openReview}
            />
          }
        >
          <Switch>
            <Match when={listSource.isLoading()}>
              <div
                role="status"
                class="grid size-full place-items-center text-sm text-ink-muted"
              >
                Loading pull requests…
              </div>
            </Match>
            <Match when={listSource.error()}>
              <div
                role="alert"
                class="flex size-full flex-col items-center justify-center gap-3 text-sm text-ink-muted"
              >
                <span>Reviews couldn’t be loaded.</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    fireAndForget(listSource.retry(), 'reviews-view')
                  }
                >
                  Try again
                </Button>
              </div>
            </Match>
            <Match when={true}>
              <ReviewsBoard
                reviews={reviews()}
                mergeability={mergeability.mergeability}
                links={{
                  linksFor,
                  companyName: links.companyName,
                  onOpen: openLink,
                }}
                scope={JSON.stringify([scope(), activeFilters(), search()])}
                hasMore={source.hasMore()}
                isLoadingMore={source.isLoadingMore()}
                onLoadMore={() => fireAndForget(loadMore(), 'reviews-view')}
                onOpen={openReview}
              />
            </Match>
          </Switch>
        </Show>
      </ViewShell.Content>
    </>
  );

  onMount(() => panel.handle.setDisplayName('Reviews'));
  return (
    <ViewBreadcrumbs.Root
      value={
        params.foreignEntityId ? `pr:${params.foreignEntityId}` : 'reviews-view'
      }
      onChange={(next) => {
        if (next === 'reviews-view') openList();
      }}
    >
      <ViewBreadcrumbs.Item
        value="reviews-view"
        order={0}
        metadata={{ type: 'reviews' }}
      >
        {(item) => (
          <ViewBreadcrumbs.ReturnButton
            isActive={item.isActive()}
            onClick={item.onSelect}
            tooltip={scopeTitle()}
          >
            {scopeTitle()}
          </ViewBreadcrumbs.ReturnButton>
        )}
      </ViewBreadcrumbs.Item>
      <SplitPanel.Root>
        <SplitPanel.Body>
          <ViewShell.Root
            asidePreferenceKey="reviews"
            resizable
            aside={{ preserveDuringResize: false }}
            main={{ preferredWidth: 640 }}
          >
            <ViewShell.Aside>
              <ReviewsSidebar
                status={statusToggle()}
                search={search()}
                onSearchChange={setSearch}
                scope={scope()}
                onScopeChange={selectScope}
                labels={facets.labels()}
                activeLabels={filters().label}
                onActiveLabelsChange={selectLabels}
                agents={agents()}
                activeAgents={filters().origin}
                onActiveAgentsChange={selectAgents}
                onOpenReview={openReview}
                activeForeignEntityId={params.foreignEntityId}
              />
            </ViewShell.Aside>
            <ViewShell.Main>
              <Suspense
                fallback={
                  <div
                    role="status"
                    class="grid size-full place-items-center text-ink-muted"
                  >
                    Loading reviews…
                  </div>
                }
              >
                <SplitRouter.Outlet fallback={list} />
              </Suspense>
            </ViewShell.Main>
          </ViewShell.Root>
        </SplitPanel.Body>
      </SplitPanel.Root>
    </ViewBreadcrumbs.Root>
  );
}

export function ReviewsView() {
  return (
    <ListEntityMetadataQueryProvider>
      <ReviewsRoot />
    </ListEntityMetadataQueryProvider>
  );
}

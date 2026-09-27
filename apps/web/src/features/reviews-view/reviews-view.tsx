import {
  SearchBar,
  ViewBreadcrumbs,
  ViewShell,
} from '@app/components/view-shell';
import {
  createSearchParams,
  SplitRouter,
  useNavigate,
  useParams,
} from '@app/lib/split-router';
import { type PillTabItem, PillTabs } from '@components/app/mobile/PillTabs';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { useUserContext } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { ListEntityMetadataQueryProvider } from '@entity';
import { GithubLabelPill } from '@entity/components/GithubLabelPill';
import { useGithubLinkStatusQuery } from '@queries/auth/github-link';
import {
  createMemo,
  createRenderEffect,
  createSignal,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import {
  activeReviewsFilterCount,
  ReviewsControls,
  ReviewsFilterDrawer,
} from './components/ReviewsControls';
import { ReviewsList } from './components/ReviewsList';
import { ReviewsSidebar } from './components/ReviewsSidebar';
import { createReviewsListController } from './primitives/create-reviews-list-controller';
import { useReviewsFacetsQuery } from './queries/use-reviews-facets-query';
import { useReviewsQuery } from './queries/use-reviews-query';
import { searchReviews } from './reviews-filter';
import { reviewsHostedContent } from './reviews-hosted-content';
import { reviewsTabSearch, reviewsTabSearchCodec } from './reviews-tab-search';
import {
  EMPTY_REVIEWS_FILTERS,
  REVIEWS_SCOPES,
  type ReviewsFilterId,
  type ReviewsFilterSelection,
  type ReviewsScope,
  type ReviewsSortId,
  scopeMatchesViewerGithubId,
} from './reviews-types';
import { reviewsPrRoute, reviewsSplitRoute } from './route';

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
  const [sort, setSort] = createSignal<ReviewsSortId>('recently_updated');
  const [filters, setFilters] = createSignal<ReviewsFilterSelection>(
    EMPTY_REVIEWS_FILTERS
  );
  const listVisible = () => !params.foreignEntityId;
  const githubLink = useGithubLinkStatusQuery({ enabled: listVisible });
  const viewer = useUserContext();
  const authorLogin = () =>
    githubLink.isPending ? undefined : githubLink.data?.username;
  const authorId = () =>
    githubLink.isPending ? undefined : githubLink.data?.userId;
  const listEnabled = () =>
    listVisible() &&
    (!scopeMatchesViewerGithubId(scope()) || Boolean(authorId()));
  const source = useReviewsQuery(
    sort,
    () => ({
      scope: scope(),
      filters: filters(),
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
  const clearFilters = () => setFilters(EMPTY_REVIEWS_FILTERS);
  const clearSearch = () => setSearch('');
  const searchForTab = (tab: ReviewsScope) => ({
    [reviewsTabSearch.namespace]: reviewsTabSearchCodec.serialize({ tab }),
  });
  const openList = () =>
    navigate(
      { route: reviewsSplitRoute, params: {} },
      { search: searchForTab(scope()) }
    );
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
    navigate(
      { route: reviewsPrRoute, params: { foreignEntityId } },
      { search: searchForTab(scope()) }
    );
  };
  const reviews = createMemo(() => searchReviews(source.reviews(), search()));
  const listController = createReviewsListController(reviews, openReview);
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
    selected: filters(),
    onFilterChange: changeFilter,
    onClearFilters: clearFilters,
  });
  const list = () => (
    <>
      <ViewShell.TopBar>
        <h1 class="hidden min-w-0 truncate text-sm font-semibold text-ink @max-[720px]/view-shell:block">
          {scopeTitle()}
        </h1>
        <ViewBreadcrumbs.Outlet
          class="@max-[720px]/view-shell:hidden"
          aria-label="Review location"
        />
      </ViewShell.TopBar>
      <ViewShell.Header>
        <Show
          when={isTouchDevice()}
          fallback={
            <div class="flex min-w-0 flex-col @max-[720px]/view-shell:gap-3">
              <div class="hidden h-8 items-center @max-[720px]/view-shell:flex">
                <h1 class="truncate text-xl font-semibold text-ink">
                  {scopeTitle()}
                </h1>
              </div>
              <div class="flex min-w-0 items-center justify-between gap-3">
                <SearchBar
                  label="Search reviews"
                  value={search()}
                  onValueChange={setSearch}
                  placeholder="Search reviews"
                  class="max-w-md flex-1"
                />
                <ReviewsControls {...controls()} />
              </div>
            </div>
          }
        >
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
        </Show>
      </ViewShell.Header>
      <ViewShell.Content>
        <ReviewsList
          list={listController}
          source={source}
          scope={scope()}
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
          hasFilters={activeReviewsFilterCount(filters()) > 0}
          onClearFilters={clearFilters}
          onClearSearch={clearSearch}
          onOpen={openReview}
        />
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
                scope={scope()}
                onScopeChange={selectScope}
                labels={facets.labels()}
                activeLabels={filters().label}
                onActiveLabelsChange={selectLabels}
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

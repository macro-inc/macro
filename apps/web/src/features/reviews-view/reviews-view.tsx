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
  ReviewsControls,
  ReviewsFilterDrawer,
  type ReviewsFilterId,
} from './components/ReviewsControls';
import { ReviewsList } from './components/ReviewsList';
import { ReviewsSidebar } from './components/ReviewsSidebar';
import { createReviewsListController } from './primitives/create-reviews-list-controller';
import { useReviewsQuery } from './queries/use-reviews-query';
import { filterReviews } from './reviews-filter';
import { reviewsHostedContent } from './reviews-hosted-content';
import { reviewsTabSearch, reviewsTabSearchCodec } from './reviews-tab-search';
import type { ReviewsScope, ReviewsSortId } from './reviews-types';
import { reviewsPrRoute, reviewsSplitRoute } from './route';

const REVIEW_SCOPE_TITLES: Record<ReviewsScope, string> = {
  all: 'All PRs',
  involving: 'Involving me',
  authored: 'Authored by me',
};
const REVIEW_SCOPE_TABS: PillTabItem<ReviewsScope>[] = [
  { value: 'involving', label: REVIEW_SCOPE_TITLES.involving },
  { value: 'all', label: REVIEW_SCOPE_TITLES.all },
  { value: 'authored', label: REVIEW_SCOPE_TITLES.authored },
];
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
  const [sort, setSort] = createSignal<ReviewsSortId>('updated_at');
  const [selectedRepositories, setSelectedRepositories] = createSignal<
    string[]
  >([]);
  const [selectedAuthors, setSelectedAuthors] = createSignal<string[]>([]);
  const listEnabled = () => !params.foreignEntityId;
  const source = useReviewsQuery(sort, scope, listEnabled);
  const githubLink = useGithubLinkStatusQuery({ enabled: listEnabled });
  const viewer = useUserContext();
  const authorLogin = () =>
    githubLink.isPending ? undefined : githubLink.data?.username;
  const authorId = () =>
    githubLink.isPending ? undefined : githubLink.data?.userId;
  const repositories = createMemo(() =>
    [
      ...new Set(
        source
          .reviews()
          .map((review) => `${review.metadata.owner}/${review.metadata.repo}`)
      ),
    ]
      .sort()
      .map((id) => ({ id, label: id }))
  );
  const authors = createMemo(() =>
    [
      ...new Set(
        source
          .reviews()
          .flatMap((review) =>
            review.metadata.authorLogin ? [review.metadata.authorLogin] : []
          )
      ),
    ]
      .sort()
      .map((id) => ({ id, label: id }))
  );
  const changeFilter = (
    group: ReviewsFilterId,
    id: string,
    selected: boolean
  ) => {
    const setter =
      group === 'repository' ? setSelectedRepositories : setSelectedAuthors;
    setter((current) => {
      if (!selected) return current.filter((value) => value !== id);
      return current.includes(id) ? current : [...current, id];
    });
  };
  const clearFilters = () => {
    setSelectedRepositories([]);
    setSelectedAuthors([]);
  };
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
  const reviews = createMemo(() =>
    filterReviews(source.reviews(), {
      scope: scope(),
      authorLogin: authorLogin(),
      authorId: authorId(),
      search: search(),
      repositories: selectedRepositories(),
      authors: selectedAuthors(),
    })
  );
  const listController = createReviewsListController(reviews, openReview);
  const controls = () => ({
    sort: sort(),
    onSortChange: setSort,
    repositories: repositories(),
    authors: authors(),
    selectedRepositories: selectedRepositories(),
    selectedAuthors: selectedAuthors(),
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
          selectedRepositories={selectedRepositories()}
          selectedAuthors={selectedAuthors()}
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

import {
  SearchBar,
  ViewBreadcrumbs,
  ViewShell,
} from '@app/components/view-shell';
import { SplitRouter, useNavigate, useParams } from '@app/lib/split-router';
import { type PillTabItem, PillTabs } from '@components/app/mobile/PillTabs';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
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
import { useReviewsQuery } from './queries/use-reviews-query';
import { reviewsHostedContent } from './reviews-hosted-content';
import type { ReviewsScope, ReviewsSortId } from './reviews-types';
import { reviewsPrRoute, reviewsSplitRoute } from './route';

const REVIEW_SCOPE_TABS: PillTabItem<ReviewsScope>[] = [
  { value: 'all', label: 'All PRs' },
  { value: 'authored', label: 'Authored by me' },
];
function ReviewsRoot() {
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  createRenderEffect(() =>
    panel.handle.updateMeta?.({ splitPanelLayout: 'composable' })
  );
  const navigate = useNavigate();
  const params = useParams<{ foreignEntityId?: string }>();
  const [scope, setScope] = createSignal<ReviewsScope>('all');
  const [search, setSearch] = createSignal('');
  const [sort, setSort] = createSignal<ReviewsSortId>('updated_at');
  const [selectedRepositories, setSelectedRepositories] = createSignal<
    string[]
  >([]);
  const [selectedAuthors, setSelectedAuthors] = createSignal<string[]>([]);
  const listEnabled = () => !params.foreignEntityId;
  const source = useReviewsQuery(sort, listEnabled);
  const githubLink = useGithubLinkStatusQuery({ enabled: listEnabled });
  const authorLogin = () =>
    githubLink.isPending ? undefined : githubLink.data?.username;
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
  const openList = () => navigate({ route: reviewsSplitRoute, params: {} });
  const selectScope = (next: ReviewsScope) => {
    setScope(next);
    if (params.foreignEntityId) openList();
  };
  const openReview = (foreignEntityId: string, event: MouseEvent) => {
    if (event.shiftKey) {
      const content = reviewsHostedContent({ type: 'pr', id: foreignEntityId });
      if (content)
        layout.openWithSplit(content, {
          preferNewSplit: true,
        });
      return;
    }
    navigate({ route: reviewsPrRoute, params: { foreignEntityId } });
  };
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
          Reviews
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
                <h1 class="truncate text-xl font-semibold text-ink">Reviews</h1>
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
          source={source}
          scope={scope()}
          authorLogin={authorLogin()}
          search={search()}
          selectedRepositories={selectedRepositories()}
          selectedAuthors={selectedAuthors()}
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
            tooltip="Reviews"
          >
            Reviews
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
              <ReviewsSidebar scope={scope()} onScopeChange={selectScope} />
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

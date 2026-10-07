import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type Accessor, For, type JSX, type ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReviewsControlProps } from './components/ReviewsControls';
import type { ReviewsServerFilter } from './queries/use-reviews-query';
import type { ReviewsScope } from './reviews-types';
import { ReviewsView } from './reviews-view';

const mocks = vi.hoisted(() => ({
  touch: false,
  narrow: false,
  collapsed: false,
  scope: 'all' as ReviewsScope,
  filter: undefined as Accessor<ReviewsServerFilter> | undefined,
}));

vi.mock('@app/components/view-shell', () => ({
  SearchBar: () => <input aria-label="Search reviews" />,
  useViewShell: () => ({
    breakpoints: { narrow: () => mocks.narrow },
    aside: { isCollapsed: () => mocks.collapsed },
  }),
  ViewShell: {
    Root: (props: ParentProps) => <div>{props.children}</div>,
    Aside: (props: ParentProps) => <aside>{props.children}</aside>,
    Main: (props: ParentProps) => <main>{props.children}</main>,
    Header: (props: ParentProps) => <header>{props.children}</header>,
    Content: (props: ParentProps) => <section>{props.children}</section>,
  },
  ViewBreadcrumbs: {
    Root: (props: ParentProps) => <div>{props.children}</div>,
    Item: () => null,
  },
}));
vi.mock('@app/lib/split-router', () => ({
  createSearchParams: () => [
    {
      get tab() {
        return mocks.scope;
      },
    },
  ],
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
  SplitRouter: {
    Outlet: (props: { fallback: () => JSX.Element }) => props.fallback(),
  },
}));
vi.mock('@app/routes/routes', () => ({
  reviewsPrRoute: {},
  reviewsSplitRoute: {},
}));
vi.mock('@components/app/mobile/PillTabs', () => ({
  PillTabs: (props: { leading: JSX.Element }) => <div>{props.leading}</div>,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({}),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: { updateMeta: vi.fn(), setDisplayName: vi.fn() },
  }),
}));
vi.mock('@components/app/split-panel', () => ({
  SplitPanel: {
    Root: (props: ParentProps) => <div>{props.children}</div>,
    Body: (props: ParentProps) => <div>{props.children}</div>,
  },
}));
vi.mock('@core/context/user', () => ({
  useUserContext: () => ({ userInfo: () => ({ name: 'Viewer' }) }),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));
vi.mock('@entity', () => ({
  ListEntityMetadataQueryProvider: (props: ParentProps) => (
    <>{props.children}</>
  ),
}));
vi.mock('@entity/components/GithubLabelPill', () => ({
  GithubLabelPill: () => null,
}));
vi.mock('@queries/auth/github-link', () => ({
  useGithubLinkStatusQuery: () => ({ isPending: false, data: undefined }),
}));
vi.mock('./components/ReviewsControls', () => {
  function Controls(props: ReviewsControlProps) {
    return (
      <div aria-label="Review filters">
        <button onClick={() => props.onFilterChange('repository', '42', true)}>
          Filter repository
        </button>
        <For each={['open', 'closed', 'merged']}>
          {(status) => (
            <button
              onClick={() =>
                props.onFilterChange(
                  'status',
                  status,
                  !props.selected.status.includes(status)
                )
              }
            >
              Toggle {status} status
            </button>
          )}
        </For>
        <button onClick={props.onClearFilters}>Clear filters</button>
      </div>
    );
  }
  return {
    activeReviewsFilterCount: (selected: ReviewsControlProps['selected']) =>
      Object.values(selected).reduce((total, ids) => total + ids.length, 0),
    ReviewsControls: Controls,
    ReviewsFilterDrawer: Controls,
  };
});
vi.mock('./components/ReviewsList', () => ({
  ReviewsList: (props: { hasFilters: boolean }) => (
    <div data-testid="reviews-list" data-has-filters={props.hasFilters} />
  ),
}));
vi.mock('./components/ReviewsSidebar', () => ({ ReviewsSidebar: () => null }));
vi.mock('./views/ReviewsListTopBar', () => ({ ReviewsListTopBar: () => null }));
vi.mock('./primitives/create-reviews-list-controller', () => ({
  createReviewsListController: () => ({}),
}));
vi.mock('./queries/use-reviews-facets-query', () => ({
  useReviewsFacetsQuery: () => ({
    repositories: () => [],
    authors: () => [],
    assignees: () => [],
    labels: () => [],
  }),
}));
vi.mock('./queries/use-reviews-query', () => ({
  useReviewsQuery: (_sort: unknown, filter: Accessor<ReviewsServerFilter>) => {
    mocks.filter = filter;
    return { reviews: () => [] };
  },
}));
vi.mock('./reviews-hosted-content', () => ({
  reviewsHostedContent: () => undefined,
}));
vi.mock('./reviews-tab-search', () => ({
  reviewsTabSearch: { namespace: 'reviews' },
  reviewsTabSearchCodec: { serialize: () => '' },
}));
vi.mock('@ui', () => ({
  Tabs: (props: {
    list: { value: string; label: string }[];
    value: string;
    onChange: (value: string) => void;
  }) => (
    <div role="radiogroup" aria-label="Pull request status">
      <For each={props.list}>
        {(tab) => (
          <button
            role="radio"
            aria-checked={tab.value === props.value}
            onClick={() => props.onChange(tab.value)}
          >
            {tab.label}
          </button>
        )}
      </For>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  mocks.touch = false;
  mocks.narrow = false;
  mocks.collapsed = false;
  mocks.scope = 'all';
  mocks.filter = undefined;
});

describe('Reviews status tab integration', () => {
  it.each([false, true])(
    'places status below search and filters, above the list (touch=%s)',
    (touch) => {
      mocks.touch = touch;
      render(() => <ReviewsView />);
      const tabs = screen.getByRole('radiogroup', {
        name: 'Pull request status',
      });
      expect(
        screen
          .getByRole('textbox', { name: 'Search reviews' })
          .compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        screen.getByLabelText('Review filters').compareDocumentPosition(tabs) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        tabs.compareDocumentPosition(screen.getByTestId('reviews-list')) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        screen.getByRole('radio', { name: 'Open' }).getAttribute('aria-checked')
      ).toBe('true');
      expect(mocks.filter?.().filters.status).toEqual(['open']);
      expect(screen.queryByRole('radio', { name: 'All' })).toBeNull();
      expect(
        screen.getByTestId('reviews-list').getAttribute('data-has-filters')
      ).toBe('false');
    }
  );

  it('maps Closed to closed and merged while preserving other filters', () => {
    render(() => <ReviewsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter repository' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Closed' }));
    expect(mocks.filter?.().filters.status).toEqual(['closed', 'merged']);
    expect(mocks.filter?.().filters.repository).toEqual(['42']);
    expect(
      screen.getByRole('radio', { name: 'Closed' }).getAttribute('aria-checked')
    ).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Open' }));
    expect(mocks.filter?.().filters.status).toEqual(['open']);
    expect(mocks.filter?.().filters.repository).toEqual(['42']);
  });

  it('resets to Open when clearing filters', () => {
    render(() => <ReviewsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter repository' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Closed' }));
    expect(
      screen.getByTestId('reviews-list').getAttribute('data-has-filters')
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(
      screen.getByRole('radio', { name: 'Open' }).getAttribute('aria-checked')
    ).toBe('true');
    expect(mocks.filter?.().filters.status).toEqual(['open']);
    expect(mocks.filter?.().filters.repository).toEqual([]);
    expect(
      screen.getByTestId('reviews-list').getAttribute('data-has-filters')
    ).toBe('false');
  });

  it.each([false, true])(
    'hides custom multi-status selections and restores presets (touch=%s)',
    (touch) => {
      mocks.touch = touch;
      render(() => <ReviewsView />);
      fireEvent.click(
        screen.getByRole('button', { name: 'Toggle merged status' })
      );
      expect(mocks.filter?.().filters.status).toEqual(['open', 'merged']);
      expect(
        screen.queryByRole('radiogroup', { name: 'Pull request status' })
      ).toBeNull();
      fireEvent.click(
        screen.getByRole('button', { name: 'Toggle open status' })
      );
      expect(mocks.filter?.().filters.status).toEqual(['merged']);
      expect(
        screen.getByRole('radiogroup', { name: 'Pull request status' })
      ).toBeTruthy();
      expect(
        screen
          .getByRole('radio', { name: 'Closed' })
          .getAttribute('aria-checked')
      ).toBe('false');
      fireEvent.click(screen.getByRole('radio', { name: 'Closed' }));
      expect(mocks.filter?.().filters.status).toEqual(['closed', 'merged']);
      expect(
        screen
          .getByRole('radio', { name: 'Closed' })
          .getAttribute('aria-checked')
      ).toBe('true');
      fireEvent.click(
        screen.getByRole('button', { name: 'Toggle open status' })
      );
      expect(mocks.filter?.().filters.status).toEqual([
        'closed',
        'merged',
        'open',
      ]);
      expect(
        screen.queryByRole('radiogroup', { name: 'Pull request status' })
      ).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
      expect(mocks.filter?.().filters.status).toEqual(['open']);
      expect(
        screen.getByRole('radio', { name: 'Open' }).getAttribute('aria-checked')
      ).toBe('true');
    }
  );
});

describe('Reviews scope context', () => {
  it.each([
    { scope: 'all', title: 'Pull requests' },
    { scope: 'authored', title: 'Authored by me' },
    { scope: 'assigned', title: 'Assigned to me' },
    { scope: 'involving', title: 'Involves me' },
    { scope: 'review_requests', title: 'Review requests' },
  ] satisfies { scope: ReviewsScope; title: string }[])(
    'keeps $title above search when the wide sidebar is collapsed',
    ({ scope, title }) => {
      mocks.scope = scope;
      mocks.collapsed = true;
      render(() => <ReviewsView />);
      const heading = screen.getByRole('heading', { name: title, level: 2 });
      expect(
        heading.compareDocumentPosition(
          screen.getByRole('textbox', { name: 'Search reviews' })
        ) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
  );

  it('retains the narrow scope heading while navigation overlays the list', () => {
    mocks.scope = 'authored';
    mocks.narrow = true;
    render(() => <ReviewsView />);
    expect(
      screen.getByRole('heading', { name: 'Authored by me', level: 2 })
    ).toBeTruthy();
  });

  it('does not duplicate the scope heading when the wide sidebar is docked', () => {
    mocks.scope = 'authored';
    render(() => <ReviewsView />);
    expect(
      screen.queryByRole('heading', { name: 'Authored by me', level: 2 })
    ).toBeNull();
  });
});

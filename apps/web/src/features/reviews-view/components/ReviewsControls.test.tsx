import { cleanup, render, screen } from '@solidjs/testing-library';
import { For, type ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_REVIEWS_FILTERS } from '../reviews-types';
import {
  activeReviewsFilterCount,
  type ReviewsControlProps,
  ReviewsControls,
  ReviewsFilterDrawer,
} from './ReviewsControls';

vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    splitHotkeyScope: 'reviews-test',
    isPanelActive: () => true,
  }),
}));
vi.mock('@app/components/view-shell', () => ({
  ListFilterDropdown: (props: {
    groups: {
      id: string;
      label: string;
      options: { id: string; label: string }[];
    }[];
  }) => (
    <div data-testid="desktop-filters">
      <For each={props.groups}>
        {(group) => (
          <div data-testid={`desktop-${group.id}`}>
            {group.label}:{' '}
            {group.options.map((option) => option.label).join(', ')}
          </div>
        )}
      </For>
    </div>
  ),
  ListSortDropdown: () => null,
  MobileFilterDrawer: Object.assign(
    (props: ParentProps & { activeCount: number }) => (
      <div data-testid="mobile-filters" data-active-count={props.activeCount}>
        {props.children}
      </div>
    ),
    {
      Section: (props: ParentProps & { label: string }) => (
        <div data-testid={`mobile-${props.label.toLowerCase()}`}>
          {props.label}: {props.children}
        </div>
      ),
      Option: (props: ParentProps) => <div>{props.children}</div>,
    }
  ),
  useViewControlHotkeys: () => {},
}));
vi.mock('@components/app/mobile/MobileDrawer', () => ({
  MobileDrawer: {
    Label: (props: ParentProps) => <div>{props.children}</div>,
    Section: (props: ParentProps) => <div>{props.children}</div>,
  },
}));
vi.mock('@kobalte/core/accordion', () => ({
  Accordion: (props: ParentProps) => <div>{props.children}</div>,
}));

const props: ReviewsControlProps = {
  sort: 'recently_updated',
  onSortChange: vi.fn(),
  repositories: [],
  authors: [],
  assignees: [],
  labels: [],
  hasGithubIdentity: false,
  selected: EMPTY_REVIEWS_FILTERS,
  onFilterChange: vi.fn(),
  onClearFilters: vi.fn(),
};

afterEach(cleanup);

describe('Reviews filter controls', () => {
  it('offers separate status choices and keeps desktop identity gates', () => {
    render(() => <ReviewsControls {...props} />);
    expect(screen.getByTestId('desktop-status').textContent).toBe(
      'Status: Open, Closed, Merged'
    );
    expect(screen.getByTestId('desktop-repository')).toBeTruthy();
    expect(screen.queryByTestId('desktop-review')).toBeNull();
  });

  it('offers separate status choices in the mobile drawer', () => {
    render(() => <ReviewsFilterDrawer {...props} hasGithubIdentity />);
    expect(screen.getByTestId('mobile-status').textContent).toBe(
      'Status: OpenClosedMerged'
    );
    expect(screen.getByTestId('mobile-repository')).toBeTruthy();
    expect(screen.getByTestId('mobile-reviews')).toBeTruthy();
  });

  it('badges the desktop filter menu for the active status selection', () => {
    const view = render(() => (
      <ReviewsControls
        {...props}
        selected={{ ...EMPTY_REVIEWS_FILTERS, status: ['open'] }}
      />
    ));
    expect(view.container.querySelector('span')?.textContent).toBe('1');
  });

  it('counts status and other filters in the desktop badge and mobile drawer', () => {
    const selected = {
      ...EMPTY_REVIEWS_FILTERS,
      status: ['closed'],
      repository: ['42'],
      label: ['bug'],
    };
    const view = render(() => (
      <>
        <ReviewsControls {...props} selected={selected} />
        <ReviewsFilterDrawer {...props} selected={selected} />
      </>
    ));
    expect(view.container.querySelector('span')?.textContent).toBe('3');
    expect(
      screen.getByTestId('mobile-filters').getAttribute('data-active-count')
    ).toBe('3');
    expect(activeReviewsFilterCount(selected)).toBe(3);
  });
});

import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewsListTopBar } from './ReviewsListTopBar';

const layout = vi.hoisted(() => ({
  narrow: (): boolean => false,
  collapsed: (): boolean => false,
}));

vi.mock('@app/components/view-shell', () => ({
  useViewShell: () => ({
    breakpoints: { narrow: () => layout.narrow() },
    aside: { isCollapsed: () => layout.collapsed() },
  }),
  ViewShell: {
    TopBar: (props: ParentProps) => <div>{props.children}</div>,
  },
  ViewBreadcrumbs: {
    Outlet: () => <nav aria-label="Review location">Pull requests</nav>,
  },
}));

afterEach(() => {
  cleanup();
  layout.narrow = () => false;
  layout.collapsed = () => false;
});

describe('Reviews list topbar', () => {
  it('keeps the scope breadcrumb when navigation is docked', () => {
    render(() => <ReviewsListTopBar />);
    expect(
      screen.getByRole('navigation', { name: 'Review location' })
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Reviews' })).toBeNull();
  });

  it('shows Reviews at narrow widths, including while navigation overlays the list', () => {
    layout.narrow = () => true;
    render(() => <ReviewsListTopBar />);
    expect(screen.getByRole('heading', { name: 'Reviews' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('shows Reviews when the wide sidebar collapses and restores the breadcrumb on expand', () => {
    const [collapsed, setCollapsed] = createSignal(false);
    layout.collapsed = collapsed;
    render(() => <ReviewsListTopBar />);
    expect(screen.getByRole('navigation')).toBeTruthy();
    setCollapsed(true);
    expect(screen.getByRole('heading', { name: 'Reviews' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    setCollapsed(false);
    expect(screen.queryByRole('heading', { name: 'Reviews' })).toBeNull();
    expect(screen.getByRole('navigation')).toBeTruthy();
  });
});

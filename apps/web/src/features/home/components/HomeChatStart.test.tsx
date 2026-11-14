import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeChatStart } from './HomeChatStart';

type ChildrenProps = { children?: JSX.Element };

const mocks = vi.hoisted(() => ({
  asideCollapsed: false,
  asideOverlay: false,
  suggestionsEnabled: false,
}));

vi.mock('@app/components/view-shell', () => ({
  useViewShell: () => ({
    aside: {
      isCollapsed: () => mocks.asideCollapsed,
      isOverlay: () => mocks.asideOverlay,
    },
  }),
  ViewShell: {
    TopBar: (props: ChildrenProps) => (
      <div data-testid="home-topbar">{props.children}</div>
    ),
  },
  ViewSidebar: {
    Title: (props: ChildrenProps) => <span>{props.children}</span>,
  },
}));
vi.mock('@channel/DebugSuspense', () => ({
  DebugSuspense: (props: ChildrenProps) => props.children,
}));
vi.mock('@app/features/suggestions/use-suggestions-flag', () => ({
  useSuggestionsFlag: () => () => mocks.suggestionsEnabled,
}));
vi.mock('@app/features/suggestions/home-priorities', () => ({
  HomePriorities: () => <div data-testid="home-today" />,
}));
vi.mock('@core/component/AI/component/DragDrop', () => ({
  DragDropWrapper: (props: ChildrenProps & { class?: string }) => (
    <div data-testid="home-composer-frame" class={props.class}>
      {props.children}
    </div>
  ),
}));
vi.mock('@core/component/AI/context', () => ({
  ChatInputProvider: (props: ChildrenProps) => props.children,
}));
vi.mock('../home-agent-composer', () => ({
  HomeAgentComposer: () => <div data-testid="home-agent-composer" />,
}));
vi.mock('./home-recommended-actions', () => ({
  HomeRecommendedActions: () => <div data-testid="home-suggestions" />,
}));

beforeEach(() => {
  mocks.asideCollapsed = false;
  mocks.asideOverlay = false;
  mocks.suggestionsEnabled = false;
});
afterEach(cleanup);

function renderHome() {
  return render(() => <HomeChatStart />);
}

describe('Home agent composer alignment', () => {
  it('matches the Agents new-conversation topbar and padding when the list is open', () => {
    renderHome();
    const grid = document.querySelector('[data-home-composer-align="agents"]');
    expect(grid).toBeTruthy();
    expect(grid?.className).toContain('pt-6');
    expect(grid?.className).toContain('pb-16');
    expect(
      document.querySelector('[data-home-composer-topbar-align]')
    ).toBeTruthy();
    expect(document.querySelector('[data-testid="home-topbar"]')).toBeNull();
  });

  it('uses the real Home topbar instead of a spacer when the list is collapsed', () => {
    mocks.asideCollapsed = true;
    renderHome();
    expect(document.querySelector('[data-testid="home-topbar"]')).toBeTruthy();
    expect(
      document.querySelector('[data-home-composer-topbar-align]')
    ).toBeNull();
    expect(
      document.querySelector('[data-home-composer-align="agents"]')
    ).toBeTruthy();
  });
});

describe('Home below the composer', () => {
  it('keeps the recommended actions while suggestions are off', () => {
    renderHome();

    expect(screen.getByTestId('home-suggestions')).toBeTruthy();
    expect(screen.queryByTestId('home-today')).toBeNull();
  });

  it('shows today and the top priorities in their place when suggestions are on', async () => {
    mocks.suggestionsEnabled = true;
    renderHome();

    expect(await screen.findByTestId('home-today')).toBeTruthy();
    expect(screen.queryByTestId('home-suggestions')).toBeNull();
  });
});

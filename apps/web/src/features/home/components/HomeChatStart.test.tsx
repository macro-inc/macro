import { cleanup, render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeChatStart } from './HomeChatStart';

type ChildrenProps = { children?: JSX.Element };

const mocks = vi.hoisted(() => ({
  asideCollapsed: false,
  asideOverlay: false,
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

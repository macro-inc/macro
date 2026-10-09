import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeChatStart } from './HomeChatStart';

type ChildrenProps = { children?: JSX.Element };

const mocks = vi.hoisted(() => ({
  agentsEnabled: true,
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
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.agentsEnabled }),
}));
vi.mock('@core/constant/featureFlags', () => ({ enableChatV3Agents: {} }));
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
vi.mock('../../universal-input/universal-input', () => ({
  UniversalInput: () => <div data-testid="universal-input" />,
}));
vi.mock('./home-recommended-actions', () => ({
  HomeRecommendedActions: () => <div data-testid="home-suggestions" />,
}));

beforeEach(() => {
  mocks.agentsEnabled = true;
  mocks.asideCollapsed = false;
  mocks.asideOverlay = false;
});
afterEach(cleanup);

function renderHome() {
  return render(() => <HomeChatStart />);
}

describe('Home universal composer', () => {
  it('starts without an AI greeting', () => {
    renderHome();
    expect(screen.getByTestId('universal-input')).toBeTruthy();
    expect(document.querySelector('h1')).toBeNull();
    expect(document.querySelector('[data-testid="home-topbar"]')).toBeNull();
  });
  it('shows the Home topbar when the list is collapsed', () => {
    mocks.asideCollapsed = true;
    renderHome();
    expect(screen.getByTestId('home-topbar')).toBeTruthy();
    expect(screen.getByTestId('universal-input')).toBeTruthy();
  });
  it('also replaces the legacy composer when agents are disabled', () => {
    mocks.agentsEnabled = false;
    renderHome();
    expect(screen.getByTestId('universal-input')).toBeTruthy();
    expect(screen.queryByText('What should we get done in Macro?')).toBeNull();
  });
});

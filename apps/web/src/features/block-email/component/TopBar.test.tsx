import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';

const actions = vi.hoisted(() => ({
  share: vi.fn(),
  read: vi.fn(),
  done: vi.fn(),
  task: vi.fn(),
  details: vi.fn(),
}));
vi.mock('@ui', async () => ({
  Button: (await import('@app/components/ui/components/Button')).Button,
  ButtonGroup: (await import('@app/components/ui/components/ButtonGroup'))
    .ButtonGroup,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/constant/featureFlags', () => ({ ENABLE_EMAIL_SHARING: true }));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ splitHotkeyScope: {} }),
}));
vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: (props: { children: JSX.Element }) => <>{props.children}</>,
  SplitHeaderRight: (props: { children: JSX.Element }) => <>{props.children}</>,
  ListNavigationButtons: () => null,
}));
vi.mock('@components/app/split-layout/components/SplitLabel', () => ({
  StaticSplitLabel: (props: { label: string }) => <h1>{props.label}</h1>,
  SplitHeaderBadge: () => null,
  SplitTitleFileMenu: (props: { children: JSX.Element }) => (
    <>{props.children}</>
  ),
}));
vi.mock('@components/app/split-layout/components/SplitFileMenu', () => ({
  BlockSplitFileMenu: () => <button>More email actions</button>,
}));
vi.mock('@components/app/ResponsiveBlockToolbar', () => ({
  ResponsiveBlockToolbar: () => null,
}));
vi.mock('@core/component/TopBar/ShareButton', () => ({
  ShareTrigger: (props: { onClick: () => void }) => (
    <button onClick={props.onClick}>Share</button>
  ),
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    HeaderActionsOutlet: () => (
      <button onClick={actions.task}>Create task</button>
    ),
    Toggle: () => <button onClick={actions.details}>Show details</button>,
  },
}));
vi.mock('./useEmailThreadTools', () => ({
  useEmailThreadTools: () => ({
    isInvite: () => false,
    tools: [],
    menuTools: [],
    emailEntity: () => undefined,
    permissions: () => undefined,
    openShare: actions.share,
    controls: {
      isOwnThread: true,
      isDone: false,
      isUnread: false,
      canToggleDone: true,
      onToggleDone: actions.done,
      onToggleUnread: actions.read,
    },
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('keeps email actions, sharing, and details available in the preview header', () => {
  render(() => <TopBar id="thread-1" title="A shared email" />);
  expect(screen.getByRole('heading', { name: 'A shared email' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Mark as unread' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
  expect(actions.read).toHaveBeenCalledOnce();
  expect(actions.done).toHaveBeenCalledOnce();
  expect(actions.share).toHaveBeenCalledOnce();
  expect(actions.task).toHaveBeenCalledOnce();
  expect(actions.details).toHaveBeenCalledOnce();
  expect(
    screen.getByRole('button', { name: 'More email actions' })
  ).toBeTruthy();
});

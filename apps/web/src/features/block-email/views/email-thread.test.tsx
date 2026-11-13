import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { ComponentProps, JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { EmailThreadHostViewProps } from '../EmailThreadHostView';
import { EmailThread } from './email-thread';

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
  cn: (await import('@app/components/ui/utils/classname')).cn,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
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
vi.mock('@core/component/TopBar/ShareButton', () => ({
  ShareTrigger: (props: { onClick: () => void }) => (
    <button onClick={props.onClick}>Share</button>
  ),
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    HeaderActions: (props: { children: JSX.Element }) => <>{props.children}</>,
    HeaderActionsOutlet: () => null,
    Toggle: () => <button onClick={actions.details}>Show details</button>,
  },
}));
vi.mock('@app/features/chat/ChatWithAgentButton', () => ({
  AskMacroButton: () => <button>Ask Macro</button>,
}));
vi.mock(
  '@app/features/email-thread/context/email-thread-state-context',
  () => ({
    useEmailThreadState: () => ({ thread: () => ({ db_id: 'thread-db-1' }) }),
  })
);
vi.mock('../EmailThreadHostView', () => ({
  EmailThreadHostView: (props: EmailThreadHostViewProps) => {
    const context = {
      createTask: actions.task,
      createEvent: () => false,
      canCreateEvent: () => false,
    };
    return (
      <>
        {props.topBar?.(context)}
        {props.actions?.(context)}
      </>
    );
  },
}));
vi.mock('../component/useEmailThreadTools', () => ({
  useEmailThreadTools: () => ({
    isInvite: () => false,
    actions: {},
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

it('keeps email actions, sharing, and details available in the desktop header', () => {
  const props = {
    title: 'A shared email',
    threadId: () => 'thread-1',
    source: {},
    threadTransport: {},
    host: {},
  } as ComponentProps<typeof EmailThread>;
  render(() => <EmailThread {...props} />);

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
  expect(screen.getByRole('button', { name: 'Ask Macro' })).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'More email actions' })
  ).toBeTruthy();
});

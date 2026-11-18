import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { StartConversation } from '../agents-view/views/NewChatPage';
import { HomeAgentComposer } from './home-agent-composer';

const mocks = vi.hoisted(() => ({
  start: vi.fn(() => 'pending-session'),
  replace: vi.fn(),
  openStartedSession: vi.fn(),
  onStart: undefined as ((start: StartConversation) => void) | undefined,
}));
vi.mock('@app/features/block-agent/context/pending-session', () => ({
  startPendingSession: mocks.start,
}));
vi.mock('./home-view-context', () => ({
  useHomeView: () => ({ openStartedSession: mocks.openStartedSession }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'viewer-1',
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ handle: { replace: mocks.replace } }),
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: vi.fn() }),
}));
vi.mock('@core/hotkey/hotkeys', () => ({ registerHotkey: vi.fn() }));
vi.mock('../agents-view/queries/agent-roster-source', () => ({
  createAgentRosterSource: () => ({
    roster: () => [],
    loading: () => false,
    availabilityLoading: () => false,
  }),
}));
vi.mock('../agents-view/views/NewChatPage', () => ({
  NewChatPage: (props: {
    draft: string;
    onDraftChange: (value: string) => void;
    onStart: (start: StartConversation) => void;
  }) => {
    mocks.onStart = props.onStart;
    return (
      <input
        aria-label="Shared draft"
        value={props.draft}
        onInput={(e) => props.onDraftChange(e.currentTarget.value)}
      />
    );
  },
}));
vi.mock('@queries/agent-session/warm', () => ({
  useWarmAgentSessionQuery: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(cleanup);

it('opens the new session inside Home', () => {
  render(() => <HomeAgentComposer />);
  const start = {
    prompt: 'Build it',
    botId: 'selected-agent',
    modelOverride: 'model',
    repoUrl: 'https://github.com/macro-inc/macro',
    repoBranch: 'feature/home',
  };
  mocks.onStart?.(start);
  // The viewer rides along so the first prompt is attributed as the log will.
  expect(mocks.start).toHaveBeenCalledWith({
    ...start,
    userId: 'viewer-1',
    submitSurface: 'home',
  });
  // The session opens in Home's detail pane instead of replacing Home.
  expect(mocks.openStartedSession).toHaveBeenCalledWith('pending-session');
  expect(mocks.replace).not.toHaveBeenCalled();
});

it('restores Home text after visiting an agent session and returning', () => {
  const first = render(() => <HomeAgentComposer />);
  fireEvent.input(screen.getByRole('textbox'), {
    target: { value: 'Unsent Home prompt' },
  });
  first.unmount();
  render(() => <HomeAgentComposer />);
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
    'Unsent Home prompt'
  );
});

it('keeps a cleared Home draft empty on the next visit', () => {
  const first = render(() => <HomeAgentComposer />);
  fireEvent.input(screen.getByRole('textbox'), {
    target: { value: 'Clear me' },
  });
  fireEvent.input(screen.getByRole('textbox'), { target: { value: '' } });
  first.unmount();
  render(() => <HomeAgentComposer />);
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
});

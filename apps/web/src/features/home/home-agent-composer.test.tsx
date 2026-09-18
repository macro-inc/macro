import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { StartConversation } from '../agents-view/views/NewChatPage';
import { HomeAgentComposer } from './home-agent-composer';

const mocks = vi.hoisted(() => ({
  start: vi.fn(() => 'pending-session'),
  replace: vi.fn(),
  buildPrompt: vi.fn(),
  failure: vi.fn(),
  pendingDraft: () => null as string | null,
  setPendingDraft: (_: string | null) => {},
  onStart: undefined as ((start: StartConversation) => void) | undefined,
}));
vi.mock('@app/features/block-agent/context/pending-session', () => ({
  startPendingSession: mocks.start,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ handle: { replace: mocks.replace } }),
}));
vi.mock('@core/component/AI/context', () => ({
  useChatInputContext: () => ({
    pendingDraft: () => mocks.pendingDraft(),
    setPendingDraft: (value: string | null) => mocks.setPendingDraft(value),
    attachments: { attached: () => [], setAttached: vi.fn() },
  }),
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: vi.fn() }),
}));
vi.mock('@core/hotkey/hotkeys', () => ({ registerHotkey: vi.fn() }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('../agents-view/queries/agent-roster-source', () => ({
  createAgentRosterSource: () => ({ roster: () => [], loading: () => false }),
}));
vi.mock('./queries/home-agent-prompt', () => ({
  buildHomeAgentPrompt: mocks.buildPrompt,
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

beforeEach(() => {
  vi.clearAllMocks();
  const [pendingDraft, setPendingDraft] = createSignal<string | null>(null);
  mocks.pendingDraft = pendingDraft;
  mocks.setPendingDraft = setPendingDraft;
});
afterEach(cleanup);

it('forwards the shared composer selection into the common session flow', () => {
  render(() => <HomeAgentComposer />);
  const start = {
    prompt: 'Build it',
    botId: 'selected-agent',
    modelOverride: 'model',
    repoUrl: 'https://github.com/macro-inc/macro',
    repoBranch: 'feature/home',
  };
  mocks.onStart?.(start);
  expect(mocks.start).toHaveBeenCalledWith(start);
  expect(mocks.replace).toHaveBeenCalledWith({
    next: { type: 'component', id: 'agents-session~agents~pending-session' },
  });
});

it('puts suggested context into the shared draft', async () => {
  mocks.buildPrompt.mockResolvedValue('Suggested task with context');
  render(() => <HomeAgentComposer />);
  mocks.setPendingDraft('Suggested task');
  await waitFor(() =>
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
      'Suggested task with context'
    )
  );
  expect(mocks.pendingDraft()).toBeNull();
});

it('does not replace a newer typed draft when suggested context resolves late', async () => {
  let resolve!: (value: string) => void;
  mocks.buildPrompt.mockReturnValue(
    new Promise<string>((done) => {
      resolve = done;
    })
  );
  render(() => <HomeAgentComposer />);
  mocks.setPendingDraft('Suggested task');
  fireEvent.input(screen.getByRole('textbox'), {
    target: { value: 'My new task' },
  });
  resolve('Late suggestion');
  await Promise.resolve();
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
    'My new task'
  );
});

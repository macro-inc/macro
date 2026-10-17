import { openEntityInSplit } from '@app/features/activity/open-entity-in-split';
import type { SplitManager } from '@components/app/split-layout/layoutManager';
import { createRoutedSplitLayout } from '@components/app/split-layout/tests/fixtures';
import { toast } from '@core/component/Toast/Toast';
import type { BlockOrchestrator } from '@core/orchestrator';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import { openDocument } from './BlockLink';

const app = vi.hoisted(() => ({
  manager: undefined as SplitManager | undefined,
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => app.manager,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => app.manager,
}));
vi.mock('@components/app/split-layout/componentRegistry', () => ({
  resolveComponent: () => ({ element: undefined }),
}));
vi.mock('@core/block', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/block')>()),
  useMaybeBlockId: () => undefined,
}));
vi.mock('@core/constant/allBlocks', () => ({
  isBlockAlias: () => false,
  resolveBlockAlias: (type: string) => type,
  fileTypeToBlockName: (type: string) => type,
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { alert: vi.fn() } }));
vi.mock('@core/util/useSplitNavigationHandler', () => ({
  useSplitNavigationHandler: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

function setup() {
  const navigate = vi.fn();
  const latest = vi.fn();
  const createBlockInstance = vi.fn();
  const orchestrator = {
    createBlockInstance,
    getBlockHandle: async () => ({
      goToLocationFromParams: navigate,
      goToLatest: latest,
    }),
  } as unknown as BlockOrchestrator;
  const manager = createRoot((dispose) => {
    onTestFinished(dispose);
    return createRoutedSplitLayout(orchestrator, '/channels/~/home');
  });
  const [chat, inbox] = manager.splits();
  manager.activateSplit(inbox.id);
  const activate = vi.fn(() => manager.activateSplit(chat.id));
  manager.registerOpenViews(() => [
    {
      owner: 'preview',
      content: { type: 'channel', id: 'channel' },
      activate,
    },
  ]);
  app.manager = manager;
  return {
    manager,
    chat,
    inbox,
    activate,
    navigate,
    latest,
    createBlockInstance,
  };
}

it.each([false, true])(
  'follows a channel mention into its inline detail (new split intent: %s)',
  async (newSplit) => {
    const { manager, chat, activate, navigate, createBlockInstance } = setup();
    const params = {
      channel_message_id: 'message',
      channel_thread_id: 'thread',
    };

    openDocument('channel', 'channel', params, newSplit);

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(params));
    expect(activate).toHaveBeenCalledOnce();
    expect(manager.activeSplitId()).toBe(chat.id);
    expect(manager.splits()).toHaveLength(2);
    expect(createBlockInstance).not.toHaveBeenCalled();
    expect(toast.alert).not.toHaveBeenCalled();
  }
);

it('keeps latest-message navigation when reusing an open channel', async () => {
  const { latest } = setup();
  openDocument('channel', 'channel');
  await vi.waitFor(() => expect(latest).toHaveBeenCalledOnce());
  expect(toast.alert).not.toHaveBeenCalled();
});

it('orients users when an activity-list selection reuses a previewed channel', () => {
  const { manager, chat, activate } = setup();
  openEntityInSplit({ block: 'channel', id: 'channel', newSplit: true });
  expect(activate).toHaveBeenCalledOnce();
  expect(manager.activeSplitId()).toBe(chat.id);
  expect(toast.alert).toHaveBeenCalledWith('Content already open');
});

it('opens a mention at its location from a click handler, which has no owner', async () => {
  const { navigate } = setup();
  const params = { channel_message_id: 'message' };
  render(() => (
    <button
      type="button"
      onClick={() => openDocument('channel', 'channel', params)}
    >
      mention
    </button>
  ));

  fireEvent.click(screen.getByRole('button', { name: 'mention' }));

  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(params));
  expect(toast.alert).not.toHaveBeenCalled();
});

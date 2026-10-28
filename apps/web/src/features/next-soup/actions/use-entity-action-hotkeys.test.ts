import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import type { EntityData } from '@entity';
import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { useEntityActionHotkeys } from './use-entity-action-hotkeys';

const { action, markDone } = vi.hoisted(() => {
  const action = () => ({
    canExecute: () => true,
    execute: vi.fn(),
    executeWithSoup: vi.fn(() => Promise.resolve()),
  });
  return { action, markDone: action() };
});

vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: vi.fn(() => ({ withGroup: vi.fn() })),
  createHotkeyGroup: () => ({ dispose: vi.fn(), addDisposer: vi.fn() }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({}),
}));
vi.mock('@app/features/next-soup/utils', () => ({
  openEntityInSplitFromUnifiedList: vi.fn(),
}));
vi.mock('@app/features/property/editor/hooks/useAllProperties', () => ({
  useAllProperties: () => () => [],
}));
vi.mock('@app/features/property/editor/state/propertyEditor', () => ({
  openPropertyEditor: vi.fn(),
}));
vi.mock('@app/features/sharing/global-share-modal/shareable-entity', () => ({
  isShareableEntityType: () => false,
}));
vi.mock('./index', () => ({
  makeAddTagAction: action,
  makeCopyAction: action,
  makeCopyBranchNameAction: action,
  makeCopyEntityIdAction: action,
  makeCopyLinkAction: action,
  makeCreateReminderAction: action,
  makeDeleteAction: action,
  makeFavoriteAction: action,
  makeMarkDoneAction: () => markDone,
  makeMarkNotDoneAction: action,
  makeMarkReadAction: action,
  makeMarkUnreadAction: action,
  makeMoveToProjectAction: action,
  makeMuteAction: action,
  makeRenameAction: action,
  makeSetCompanyPropertyAction: action,
  makeShareAction: action,
}));

it('marks one selection per key press and ignores key auto-repeat', () => {
  createRoot((dispose) => {
    const thread = { type: 'email', id: 'thread', done: false } as EntityData;
    useEntityActionHotkeys({
      scopeId: 'list',
      list: {} as never,
      selectedEntities: () => [],
      focusedEntity: () => thread,
      restoreFocus: () => undefined,
      viewContext: () => ({ supportsMarkDone: true }) as never,
    });
    const handler = vi
      .mocked(registerHotkey)
      .mock.calls.find(
        ([options]) => options.hotkeyToken === TOKENS.entity.action.markDone
      )![0].keyDownHandler!;
    const repeat = new KeyboardEvent('keydown', { key: 'e', repeat: true });
    expect(handler(repeat)).toBe(true);
    expect(markDone.executeWithSoup).not.toHaveBeenCalled();
    expect(handler(new KeyboardEvent('keydown', { key: 'e' }))).toBe(true);
    expect(markDone.executeWithSoup).toHaveBeenCalledOnce();
    dispose();
  });
});

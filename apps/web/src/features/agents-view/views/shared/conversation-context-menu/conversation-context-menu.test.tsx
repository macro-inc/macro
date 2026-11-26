import type { EntityActionListState } from '@app/features/next-soup/actions';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConversationContextMenu } from './conversation-context-menu';

const drawer = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('@app/features/soup', async () => ({
  SoupEntityContextMenu: (
    await import('@app/features/soup/SoupEntityContextMenu')
  ).SoupEntityContextMenu,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => true }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@app/features/soup/SoupEntityActionDrawerContext', () => ({
  useSoupEntityActionDrawer: () => drawer,
}));
vi.mock('@app/features/next-soup/actions', () => ({
  makeAddTagAction: () => ({ canExecute: () => false }),
}));
vi.mock('@app/features/next-soup/actions/folder-drop-zone', () => ({
  createFolderRowDropTarget: () => undefined,
}));
vi.mock('@property/tags/tag-drag-and-drop', () => ({
  createTagDropTarget: () => undefined,
}));
vi.mock('@property/tags/DroppedTagApplier', () => ({
  DroppedTagApplier: () => null,
}));
vi.mock('@app/features/soup/SoupEntityMenuPickers', () => ({
  createSoupEntityMenuPickers: () => ({
    openProjectPicker: vi.fn(),
    openTagPicker: () => undefined,
    Pickers: () => null,
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  drawer.open.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const focus = vi.fn();
  const onOpenChange = vi.fn();
  const list = {
    focus: { set: focus },
    selection: { clear: vi.fn() },
  } as unknown as EntityActionListState;
  render(() => (
    <ConversationContextMenu
      conversation={{
        type: 'agent_session',
        id: 'session',
        name: 'Conversation',
        ownerId: 'user',
        botId: 'agent',
        status: 'acp_ready',
        turnState: 'complete',
      }}
      list={list}
      onOpenChange={onOpenChange}
    >
      <button>Conversation</button>
    </ConversationContextMenu>
  ));
  return {
    row: screen.getByRole('button', { name: 'Conversation' }),
    focus,
    onOpenChange,
  };
}

it('opens row actions on a real long press and focuses the row', async () => {
  const { row, focus, onOpenChange } = setup();
  fireEvent.touchStart(row, { touches: [{ clientX: 20, clientY: 20 }] });
  await vi.advanceTimersByTimeAsync(500);
  expect(drawer.open).toHaveBeenCalledOnce();
  expect(drawer.open).toHaveBeenCalledWith(
    expect.objectContaining({
      entity: expect.objectContaining({ id: 'session' }),
    })
  );
  expect(onOpenChange).toHaveBeenCalledWith(true);
  expect(focus).toHaveBeenCalledWith('session');
  fireEvent.touchEnd(row, { touches: [] });
});

it('cancels a scrolling touch instead of opening actions', async () => {
  const { row } = setup();
  fireEvent.touchStart(row, { touches: [{ clientX: 20, clientY: 20 }] });
  fireEvent.touchMove(row, { touches: [{ clientX: 20, clientY: 60 }] });
  await vi.advanceTimersByTimeAsync(500);
  expect(drawer.open).not.toHaveBeenCalled();
});

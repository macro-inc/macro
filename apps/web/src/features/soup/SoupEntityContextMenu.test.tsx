import { GlobalBulkEditEntityModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import type {
  EntityActionListState,
  EntityActionViewContext,
} from '@app/features/next-soup/actions';
import { makeDeleteAction } from '@app/features/next-soup/actions/make-delete-action';
import type { EntityData, TaskEntity } from '@entity';
import type { NotificationMuteMenuProps } from '@notifications/components/NotificationMuteMenu';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { Dialog } from '@ui/components/Dialog';
import {
  ImperativeDialogHost,
  type ManagedDialogProps,
  openDialog,
} from '@ui/components/ImperativeDialog';
import type { Component } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoupEntityContextMenu } from './SoupEntityContextMenu';

type TestAction = {
  id: string;
  label: string;
  onClick: () => void | Promise<unknown>;
  muteMenu?: NotificationMuteMenuProps;
  menuItem?: Component<{ onActionComplete?: () => void }>;
};

const actions = vi.hoisted(() => ({ items: [] as TestAction[] }));
const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/directive/touchHandler', () => ({ touchHandler: () => {} }));
vi.mock('@entity', async () => {
  const { createContext } = await import('solid-js');
  return {
    EntityDragSelectionContext: createContext(),
    isEmailEntity: (entity: EntityData) => entity.type === 'email',
  };
});
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
vi.mock('./SoupEntityActionDrawerContext', () => ({
  useSoupEntityActionDrawer: () => undefined,
}));
vi.mock('./SoupEntityMenuPickers', () => ({
  createSoupEntityMenuPickers: () => ({
    openProjectPicker: () => {},
    openTagPicker: () => undefined,
    Pickers: () => null,
  }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  globalRemoveFromSplitHistory: () => {},
  useSplitPanelOrThrow: () => ({
    handle: { content: () => ({ type: 'email', id: 'mail' }) },
  }),
}));
vi.mock('./createSoupEntityActions', () => ({
  createSoupEntityActions: () => ({
    buildActionGroups: () => [{ id: 'actions', items: actions.items }],
  }),
  viewedProjectIdFromContent: () => undefined,
}));

// Delete's own action, its confirmation and focus moves; only the request is
// replaced.
vi.mock('@app/features/next-soup/utils', () => ({
  restoreSoupFocus: async () => {},
}));
vi.mock('@app/signal/splitLayout', () => ({ globalSplitManager: () => {} }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: () => {}, failure: () => {} },
}));
vi.mock('@app/features/entity/queries/dss', () => ({
  createBulkDeleteDssItemsMutation: () => ({ mutateAsync }),
}));
vi.mock(
  '@app/features/entity/bulk-edit/components/EntityActionSelection',
  () => ({ EntityActionSelection: () => null })
);

const entity = { id: 'thread-1', type: 'email', name: 'Lunch?' } as EntityData;
const viewContext: EntityActionViewContext = {
  supportsMarkDone: false,
  supportsOpenInNewSplit: true,
  senderBucket: undefined,
};

// The app's dialog, which Escape dismisses like every other layer.
const TestDialog = (props: ManagedDialogProps) => (
  <Dialog open={props.open} onOpenChange={props.onOpenChange}>
    <Dialog.Title>Share: Lunch?</Dialog.Title>
  </Dialog>
);

function renderRow(
  row: EntityData = entity,
  list = {} as EntityActionListState
) {
  render(() => (
    <>
      <SoupEntityContextMenu
        entity={row}
        list={list}
        selectedEntities={() => []}
        viewContext={viewContext}
      >
        <button type="button">{row.name}</button>
      </SoupEntityContextMenu>
      <ImperativeDialogHost />
      <GlobalBulkEditEntityModal />
    </>
  ));
}

async function openMenu(name = 'Lunch?') {
  fireEvent.contextMenu(screen.getByRole('button', { name }), {
    clientX: 20,
    clientY: 20,
  });
  await screen.findByRole('menu');
}

function choose(name: string | RegExp) {
  fireEvent.keyDown(screen.getByRole('menuitem', { name }), { key: 'Enter' });
}

// Kobalte closes a menu on select in a timeout; wait it out and a task more.
// `hidden`: a modal dialog hides the menu under it from role queries.
async function settle() {
  await waitFor(() =>
    expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
}

let animationStyle: HTMLStyleElement;

beforeEach(() => {
  // jsdom has no animations: closed layers unmount as in a browser.
  animationStyle = document.createElement('style');
  animationStyle.textContent = '* { animation-name: none !important; }';
  document.head.append(animationStyle);
  // jsdom has no CSS.escape; menus restore focus by a selector built with it.
  vi.stubGlobal('CSS', {
    escape: (value: string) => value.replace(/[^\w-]/g, (char) => `\\${char}`),
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  actions.items = [];
  mutateAsync.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  animationStyle.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('row context menu', () => {
  // Fails if the menu dismisses itself after an item with a synthetic
  // Escape: the dialog the item just opened is the top layer and takes it.
  it('keeps the dialog an item opened', async () => {
    actions.items = [
      {
        id: 'share',
        label: 'Share',
        onClick: async () => {
          openDialog(TestDialog, {});
        },
      },
    ];
    renderRow();
    await openMenu();
    choose('Share');
    await settle();

    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  // The same failure, through Delete's real action and confirmation: Delete
  // on a task did nothing while the menu dismissed itself after items.
  it("keeps a task's delete confirmation open, and deletes on confirm", async () => {
    const task: TaskEntity = {
      id: 'task',
      name: 'Write the plan',
      ownerId: 'owner',
      type: 'document',
      fileType: 'md',
      subType: { type: 'task' },
    };
    const list = {
      focus: { id: () => 'task', index: () => 0, set: () => {} },
      navigate: { peekOffset: () => undefined },
      items: { count: () => 1, get: () => undefined, at: () => undefined },
      selection: { clear: () => {} },
    } as unknown as EntityActionListState;
    const deleteAction = makeDeleteAction({ userId: () => 'owner' });
    actions.items = [
      {
        id: 'delete',
        label: 'Delete',
        onClick: () => deleteAction.executeWithSoup([task], list),
      },
    ];
    renderRow(task, list);
    await openMenu('Write the plan');
    choose('Delete');
    await settle();

    expect(screen.getByRole('dialog', { name: 'Delete item?' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete item' }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledExactlyOnceWith([task])
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the dialog of a custom mute open', async () => {
    actions.items = [
      {
        id: 'mute',
        label: 'Mute notifications',
        onClick: () => {},
        muteMenu: {
          label: 'Mute notifications',
          unmuteLabel: 'Unmute notifications',
          muted: false,
          onMute: () => {},
          onSnooze: (until) => {
            if (!until) openDialog(TestDialog, {});
          },
        },
      },
    ];
    renderRow();
    await openMenu();
    fireEvent.keyDown(
      screen.getByRole('menuitem', { name: 'Mute notifications' }),
      { key: 'ArrowRight' }
    );
    choose('Custom…');
    await settle();

    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  // Fails if an item that finishes after the menu closed (a Favorite still
  // saving) dismisses whatever menu is open by then.
  it('leaves the menu opened again while an earlier item was saving', async () => {
    const saving = Promise.withResolvers<void>();
    actions.items = [
      { id: 'favorite', label: 'Favorite', onClick: () => saving.promise },
    ];
    renderRow();
    await openMenu();
    choose('Favorite');
    await settle();

    await openMenu();
    saving.resolve();
    await saving.promise;
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('closes after an item that throws', async () => {
    actions.items = [
      {
        id: 'tab',
        label: 'Open in new tab',
        onClick: () => {
          throw new Error('no tab');
        },
      },
    ];
    renderRow();
    await openMenu();
    choose('Open in new tab');

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('closes when an embedded picker is done with it', async () => {
    actions.items = [
      {
        id: 'tags',
        label: 'Add tag',
        onClick: () => {},
        menuItem: (props) => (
          <button type="button" onClick={() => props.onActionComplete?.()}>
            Open tagged items
          </button>
        ),
      },
    ];
    renderRow();
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Open tagged items' }));

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});

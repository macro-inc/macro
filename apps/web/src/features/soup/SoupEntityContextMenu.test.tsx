import type {
  EntityActionListState,
  EntityActionViewContext,
} from '@app/features/next-soup/actions';
import type { EntityData } from '@entity';
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

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/directive/touchHandler', () => ({ touchHandler: () => {} }));
vi.mock('@entity', async () => {
  const { createContext } = await import('solid-js');
  return { EntityDragSelectionContext: createContext() };
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

function renderRow() {
  render(() => (
    <>
      <SoupEntityContextMenu
        entity={entity}
        list={{} as EntityActionListState}
        selectedEntities={() => []}
        viewContext={viewContext}
      >
        <button type="button">Lunch?</button>
      </SoupEntityContextMenu>
      <ImperativeDialogHost />
    </>
  ));
}

async function openMenu() {
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Lunch?' }), {
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

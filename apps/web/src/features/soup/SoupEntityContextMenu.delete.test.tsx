import { GlobalBulkEditEntityModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import type {
  EntityActionListState,
  EntityActionViewContext,
} from '@app/features/next-soup/actions';
import { makeDeleteAction } from '@app/features/next-soup/actions/make-delete-action';
import type { TaskEntity } from '@entity';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoupEntityContextMenu } from './SoupEntityContextMenu';

const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/directive/touchHandler', () => ({ touchHandler: () => {} }));
vi.mock('@entity', async () => {
  const { createContext } = await import('solid-js');
  return {
    EntityDragSelectionContext: createContext(),
    isEmailEntity: (entity: { type: string }) => entity.type === 'email',
  };
});
vi.mock('@app/features/next-soup/actions', () => ({
  makeAddTagAction: () => ({ canExecute: () => false }),
}));
vi.mock('@app/features/next-soup/actions/folder-drop-zone', () => ({
  createFolderRowDropTarget: () => undefined,
}));
vi.mock('@app/features/next-soup/utils', () => ({
  restoreSoupFocus: async () => {},
  trashEmails: () => ({ undo: async () => {}, done: Promise.resolve() }),
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
    handle: { content: () => ({ type: 'component', id: 'tasks' }) },
  }),
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
// The real Delete item, as the task rows' menus build it.
vi.mock('./createSoupEntityActions', () => ({
  createSoupEntityActions: () => {
    const deleteAction = makeDeleteAction({ userId: () => 'owner' });
    return {
      buildActionGroups: (
        list: EntityActionListState,
        entities: TaskEntity[]
      ) => [
        {
          id: 'delete',
          items: [
            {
              id: 'delete',
              label: 'Delete',
              onClick: () => deleteAction.executeWithSoup(entities, list),
            },
          ],
        },
      ],
    };
  },
  viewedProjectIdFromContent: () => undefined,
}));

const task: TaskEntity = {
  id: 'task',
  name: 'Write the plan',
  ownerId: 'owner',
  type: 'document',
  fileType: 'md',
  subType: { type: 'task' },
};
const viewContext: EntityActionViewContext = {
  supportsMarkDone: true,
  supportsOpenInNewSplit: true,
  senderBucket: undefined,
};
const list = {
  focus: { id: () => 'task', index: () => 0, set: () => {} },
  navigate: { peekOffset: () => undefined },
  items: { count: () => 1, get: () => undefined, at: () => undefined },
  selection: { clear: () => {} },
} as unknown as EntityActionListState;

function renderTaskRow() {
  render(() => (
    <>
      <SoupEntityContextMenu
        entity={task}
        list={list}
        selectedEntities={() => []}
        viewContext={viewContext}
      >
        <button type="button">Write the plan</button>
      </SoupEntityContextMenu>
      <GlobalBulkEditEntityModal />
    </>
  ));
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
  mutateAsync.mockReset().mockResolvedValue([true]);
});

afterEach(() => {
  cleanup();
  animationStyle.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a task row's context menu", () => {
  // Fails if the menu dismisses itself after Delete with a synthetic
  // Escape: the confirmation Delete just opened is the top layer and takes it.
  it('keeps the delete confirmation open and deletes the task', async () => {
    renderTaskRow();
    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'Write the plan' }),
      { clientX: 20, clientY: 20 }
    );
    await screen.findByRole('menu');
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Delete' }), {
      key: 'Enter',
    });

    // Kobalte closes a menu on select in a timeout; wait it out and a task
    // more. `hidden`: the modal dialog hides the menu from role queries.
    await waitFor(() =>
      expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.getByRole('dialog', { name: 'Delete item?' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete item' }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledExactlyOnceWith([task])
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

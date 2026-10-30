import type { EntityData, EntityDragData } from '@entity';
import { cleanup, render, screen } from '@solidjs/testing-library';
import {
  createDraggable,
  DragDropProvider,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { For, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  moveEntities: vi.fn(),
  toast: { success: vi.fn(), failure: vi.fn(), dismiss: vi.fn() },
}));

vi.mock('@app/features/entity/bulk-edit/BulkEditEntityModal', () => ({
  openBulkEditModal: vi.fn(),
}));
vi.mock('@app/features/entity/bulk-edit/move-entities-to-folder', () => ({
  createMoveEntitiesToFolder: () => mocks.moveEntities,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => ({ handle: { id: 'folder-split' } }),
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: mocks.toast }));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'macro|me' }));
vi.mock('@queries/storage/folder-list', () => ({
  createFolderList: () => ({
    folders: () => [
      { id: 'folder', name: 'Folder', parentId: 'parent', userId: 'macro|me' },
      { id: 'parent', name: 'Parent', userId: 'macro|me' },
      { id: 'other', name: 'Other', userId: 'macro|me' },
    ],
    isPending: () => false,
  }),
}));
vi.mock('../utils', () => ({ restoreSoupFocus: vi.fn() }));

import { createFolderDropTargets, FolderDropZone } from './folder-drop-zone';

const doc = (id: string, ownerId = 'macro|me'): EntityData => ({
  id,
  type: 'document',
  name: id,
  ownerId,
});

function dragData(
  entity: EntityData,
  options: {
    splitId?: string;
    selected?: EntityData[];
    clear?: () => void;
    operation?: 'move' | 'copy';
  }
): EntityDragData {
  return {
    ...entity,
    dragType: 'entity',
    operation: () => options.operation ?? 'move',
    splitId: options.splitId ?? 'list-split',
    selection: options.selected && {
      entities: () => options.selected ?? [],
      isSelected: () => true,
      clear: options.clear ?? (() => {}),
    },
  };
}

function setup(data: EntityDragData, target: () => JSX.Element = FolderBody) {
  let actions!: NonNullable<ReturnType<typeof useDragDropContext>>[1];
  function Harness() {
    const context = useDragDropContext();
    if (!context) throw new Error('Missing drag provider');
    actions = context[1];
    const draggable = createDraggable('row', data);
    return (
      <>
        <div ref={draggable}>Row</div>
        {target()}
      </>
    );
  }
  render(() => (
    <DragDropProvider
      collisionDetector={(_, droppables) =>
        droppables.find((droppable) => {
          const disabled = droppable.data.isDropTargetDisabled as () => boolean;
          return !disabled();
        }) ?? null
      }
    >
      <Harness />
    </DragDropProvider>
  ));
  return {
    start: () => actions.dragStart('row'),
    drop: () => actions.dragEnd(),
  };
}

function FolderBody() {
  return <FolderDropZone folderId="folder">Folder contents</FolderDropZone>;
}

/** Folder rows as Drive's sidebar builds them: one controller, one target each. */
function FolderRows() {
  const createTarget = createFolderDropTargets();
  return (
    <For each={['folder', 'other']}>
      {(id) => {
        const target = createTarget?.(() => id);
        return (
          <div
            ref={(element) => target?.ref(element)}
            data-testid={id}
            data-over={target?.isOver()}
          />
        );
      }}
    </For>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FolderDropZone', () => {
  it('moves the whole selection and clears it', async () => {
    mocks.moveEntities.mockResolvedValue(undefined);
    const clear = vi.fn();
    const first = doc('first');
    const second = doc('second');
    const { start, drop } = setup(
      dragData(first, { selected: [first, second], clear })
    );

    start();
    expect(screen.getByText('Move 2 items to this folder')).toBeTruthy();
    drop();
    await vi.waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());

    expect(mocks.moveEntities).toHaveBeenCalledWith([first, second], {
      id: 'folder',
      name: 'Folder',
    });
    expect(clear).toHaveBeenCalled();
  });

  it('moves a row that carries no selection', async () => {
    mocks.moveEntities.mockResolvedValue(undefined);
    const { start, drop } = setup(dragData(doc('row'), {}));

    start();
    expect(screen.getByText('Move 1 item to this folder')).toBeTruthy();
    drop();
    await vi.waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());

    expect(mocks.moveEntities.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it('skips selected rows the folder already holds', async () => {
    mocks.moveEntities.mockResolvedValue(undefined);
    const held = { ...doc('held'), projectId: 'folder' };
    const moved = doc('moved');
    const { start, drop } = setup(dragData(moved, { selected: [held, moved] }));

    start();
    drop();
    await vi.waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());

    expect(mocks.moveEntities.mock.calls[0]?.[0]).toEqual([moved]);
  });

  it('refuses a selection holding a row the user cannot move', () => {
    const mine = doc('mine');
    const theirs = doc('theirs', 'macro|teammate');
    const { start, drop } = setup(dragData(mine, { selected: [mine, theirs] }));

    start();
    expect(screen.queryByText(/to this folder/)).toBeNull();
    drop();

    expect(mocks.moveEntities).not.toHaveBeenCalled();
  });

  it('refuses a row dragged within its own split', () => {
    const { start, drop } = setup(
      dragData(doc('row'), { splitId: 'folder-split' })
    );

    start();
    expect(screen.queryByText(/to this folder/)).toBeNull();
    drop();

    expect(mocks.moveEntities).not.toHaveBeenCalled();
  });

  it('refuses to put a folder inside its own subfolder', () => {
    const parent: EntityData = {
      id: 'parent',
      type: 'project',
      name: 'Parent',
      ownerId: 'macro|me',
    };
    const { start, drop } = setup(dragData(parent, {}));

    start();
    drop();

    expect(mocks.moveEntities).not.toHaveBeenCalled();
  });

  it('moves a row into a sidebar folder from the split it sits in', async () => {
    mocks.moveEntities.mockResolvedValue(undefined);
    const row = doc('row');
    const { start, drop } = setup(
      dragData(row, { splitId: 'folder-split' }),
      FolderRows
    );

    start();
    drop();
    await vi.waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());

    expect(mocks.moveEntities).toHaveBeenCalledTimes(1);
    expect(mocks.moveEntities.mock.calls[0]?.[1]).toEqual({
      id: 'folder',
      name: 'Folder',
    });
  });

  it('skips a sidebar folder that already holds the row', async () => {
    mocks.moveEntities.mockResolvedValue(undefined);
    const held = { ...doc('held'), projectId: 'folder' };
    const { start, drop } = setup(dragData(held, {}), FolderRows);

    start();
    expect(screen.getByTestId('folder').dataset.over).toBe('false');
    expect(screen.getByTestId('other').dataset.over).toBe('true');
    drop();
    await vi.waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());

    expect(mocks.moveEntities.mock.calls[0]?.[1]).toEqual({
      id: 'other',
      name: 'Other',
    });
  });

  it('moves once when a folder pane and sidebar rows share the drag', async () => {
    mocks.moveEntities.mockResolvedValue(undefined);
    const { start, drop } = setup(dragData(doc('row'), {}), () => (
      <>
        <FolderRows />
        <FolderBody />
      </>
    ));

    start();
    drop();
    await vi.waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());

    expect(mocks.moveEntities).toHaveBeenCalledTimes(1);
  });

  it('refuses a drag held as a copy', () => {
    const { start, drop } = setup(dragData(doc('row'), { operation: 'copy' }));

    start();
    expect(screen.queryByText(/to this folder/)).toBeNull();
    drop();

    expect(mocks.moveEntities).not.toHaveBeenCalled();
  });

  it('clears the selection only once the move lands', async () => {
    let finishMove = () => {};
    mocks.moveEntities.mockReturnValue(
      new Promise<void>((resolve) => {
        finishMove = resolve;
      })
    );
    const clear = vi.fn();
    const row = doc('row');
    const { start, drop } = setup(dragData(row, { selected: [row], clear }));

    start();
    drop();
    await vi.waitFor(() => expect(mocks.moveEntities).toHaveBeenCalled());
    expect(clear).not.toHaveBeenCalled();

    finishMove();
    await vi.waitFor(() => expect(clear).toHaveBeenCalled());
  });

  it('reports a failed move and keeps the selection', async () => {
    mocks.moveEntities.mockRejectedValue(new Error('offline'));
    const clear = vi.fn();
    const row = doc('row');
    const { start, drop } = setup(dragData(row, { selected: [row], clear }));

    start();
    drop();

    await vi.waitFor(() => expect(mocks.toast.failure).toHaveBeenCalled());
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });
});

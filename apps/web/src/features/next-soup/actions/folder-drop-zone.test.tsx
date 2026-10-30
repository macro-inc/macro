import type { EntityData, EntityDragData } from '@entity';
import { cleanup, render, screen } from '@solidjs/testing-library';
import {
  createDraggable,
  DragDropProvider,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
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
    ],
    isPending: () => false,
  }),
}));
vi.mock('../utils', () => ({ restoreSoupFocus: vi.fn() }));

import { FolderDropZone } from './folder-drop-zone';

const doc = (id: string, ownerId = 'macro|me'): EntityData => ({
  id,
  type: 'document',
  name: id,
  ownerId,
});

function dragData(
  entity: EntityData,
  options: { splitId?: string; selected?: EntityData[]; clear?: () => void }
): EntityDragData {
  return {
    ...entity,
    dragType: 'entity',
    operation: () => 'move',
    splitId: options.splitId ?? 'list-split',
    selection: options.selected && {
      entities: () => options.selected ?? [],
      clear: options.clear ?? (() => {}),
    },
  };
}

function setup(data: EntityDragData) {
  let actions!: NonNullable<ReturnType<typeof useDragDropContext>>[1];
  function Harness() {
    const context = useDragDropContext();
    if (!context) throw new Error('Missing drag provider');
    actions = context[1];
    const draggable = createDraggable('row', data);
    return (
      <>
        <div ref={draggable}>Row</div>
        <FolderDropZone folderId="folder">Folder contents</FolderDropZone>
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

  it('reports a failed move', async () => {
    mocks.moveEntities.mockRejectedValue(new Error('offline'));
    const { start, drop } = setup(dragData(doc('row'), {}));

    start();
    drop();

    await vi.waitFor(() => expect(mocks.toast.failure).toHaveBeenCalled());
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
});

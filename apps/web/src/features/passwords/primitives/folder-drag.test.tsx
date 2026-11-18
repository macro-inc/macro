import { DragSessionSensors } from '@app/components/drag-drop/drag-session-sensors';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import {
  createDraggable,
  DragDropProvider,
  DragDropSensors,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { For } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createFixtureScope } from '../tests/fixture-scope';
import { createPasswordFolderDrag } from './folder-drag';

afterEach(cleanup);

function setup(parentId: string | null, manageable = true) {
  const scope = createFixtureScope();
  const folders = [
    { id: 'a', name: 'A', parentId: null },
    { id: 'child', name: 'Child', parentId: 'a' },
    { id: 'b', name: 'B', parentId: null },
  ];
  const items = [
    { id: 'item', name: 'Item', folderId: 'a', canManage: manageable },
  ];
  const moveFolder = vi.fn(async () => true);
  const moveItem = vi.fn(async () => {});
  let context!: NonNullable<ReturnType<typeof useDragDropContext>>;
  let controller!: NonNullable<ReturnType<typeof createPasswordFolderDrag>>;
  function Harness() {
    const active = useDragDropContext();
    if (!active) throw new Error('Fixture provider required');
    context = active;
    const drag = createPasswordFolderDrag({
      scope: scope.scope,
      folders: () => folders,
      items: () => items,
      moveFolder,
      moveItem,
    });
    if (!drag) throw new Error('Fixture drag controller required');
    controller = drag;
    const target = drag.target(() => parentId);
    const foreign = createDraggable('foreign', {
      dragType: 'passwords',
      owner: Symbol('foreign'),
      resource: 'folder',
      id: 'a',
    });
    let viewport: HTMLDivElement | undefined;
    return (
      <div ref={viewport}>
        <DragSessionSensors
          reuseProviderSensors
          axis="both"
          getViewport={() => (drag.isDragging() ? viewport : undefined)}
          onCancel={drag.cancel}
        />
        <For each={folders}>
          {(folder) => {
            const row = drag.source('folder', folder.id, () => null);
            return (
              <button type="button" {...row}>
                {folder.name}
              </button>
            );
          }}
        </For>
        <div ref={drag.source('item', 'item', () => null).ref}>Item</div>
        <div ref={foreign.ref}>Foreign</div>
        <div ref={target.ref}>Destination</div>
      </div>
    );
  }
  render(() => (
    <DragDropProvider
      collisionDetector={(_, targets) =>
        targets.find((target) => {
          const disabled: unknown = target.data.isDropTargetDisabled;
          return typeof disabled === 'function' && !disabled();
        }) ?? null
      }
    >
      <DragDropSensors />
      <Harness />
    </DragDropProvider>
  ));
  return {
    moveFolder,
    moveItem,
    scope,
    folders,
    start(id: string) {
      const row = Object.values(context[0].draggables).find(
        (entry) => entry.data.id === id && entry.id !== 'foreign'
      );
      if (!row) throw new Error('Fixture source missing');
      context[1].dragStart(row.id);
    },
    foreign() {
      context[1].dragStart('foreign');
    },
    drop() {
      context[1].dragEnd();
    },
    cancel: () => controller.cancel(),
    sensorCount: () => Object.keys(context[0].sensors).length,
    active: () => context[0].active.draggableId,
  };
}

it('moves a folder once through the supplied Passwords command', async () => {
  const f = setup('b');
  f.start('a');
  f.drop();
  await vi.waitFor(() =>
    expect(f.moveFolder).toHaveBeenCalledExactlyOnceWith('a', 'b')
  );
  expect(f.moveItem).not.toHaveBeenCalled();
});

it('moves a nested folder to the root and an manageable item into a folder', async () => {
  const root = setup(null);
  root.start('child');
  root.drop();
  await vi.waitFor(() =>
    expect(root.moveFolder).toHaveBeenCalledExactlyOnceWith('child', null)
  );
  cleanup();
  const f = setup('b');
  f.start('item');
  f.drop();
  await vi.waitFor(() =>
    expect(f.moveItem).toHaveBeenCalledExactlyOnceWith('item', 'b')
  );
});

it.each(['a', 'child', null])(
  'rejects a self, descendant or unchanged-parent drop onto %s',
  (target) => {
    const f = setup(target);
    f.start('a');
    f.drop();
    expect(f.moveFolder).not.toHaveBeenCalled();
  }
);

it('rejects stale scopes, foreign payloads and non-manager item moves', () => {
  const f = setup('b', false);
  f.start('item');
  f.drop();
  f.foreign();
  f.drop();
  f.start('a');
  f.scope.end();
  f.drop();
  expect(f.moveFolder).not.toHaveBeenCalled();
  expect(f.moveItem).not.toHaveBeenCalled();
});

it('reuses one sensor and cancels only its own drag on Escape and blur', () => {
  const f = setup('b');
  expect(f.sensorCount()).toBe(1);
  f.start('a');
  fireEvent.keyDown(document, { key: 'Escape' });
  f.drop();
  f.start('a');
  fireEvent.blur(window);
  f.drop();
  expect(f.moveFolder).not.toHaveBeenCalled();
  f.foreign();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(f.active()).toBe('foreign');
  f.drop();
  expect(f.moveFolder).not.toHaveBeenCalled();
});

it('retains the original tree on a failed move and allows a later retry', async () => {
  const f = setup('b');
  f.moveFolder.mockResolvedValue(false);
  f.start('a');
  f.drop();
  await vi.waitFor(() => expect(f.moveFolder).toHaveBeenCalledTimes(1));
  expect(f.folders.find((folder) => folder.id === 'a')?.parentId).toBeNull();
  f.start('a');
  f.drop();
  await vi.waitFor(() => expect(f.moveFolder).toHaveBeenCalledTimes(2));
});

it('keeps the existing standalone sensor behavior for callers without reuse mode', () => {
  let context!: NonNullable<ReturnType<typeof useDragDropContext>>;
  const cancelled = vi.fn();
  function Harness() {
    const active = useDragDropContext();
    if (!active) throw new Error('Fixture provider required');
    context = active;
    const source = createDraggable('standalone');
    return (
      <>
        <DragSessionSensors
          axis="x"
          getViewport={() => undefined}
          onCancel={cancelled}
        />
        <div ref={source.ref}>Standalone</div>
      </>
    );
  }
  render(() => (
    <DragDropProvider>
      <Harness />
    </DragDropProvider>
  ));
  expect(Object.keys(context[0].sensors)).toHaveLength(1);
  context[1].dragStart('standalone');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(cancelled).toHaveBeenCalledOnce();
  expect(context[0].active.draggableId).toBeNull();
  context[1].dragStart('standalone');
  fireEvent.blur(window);
  expect(cancelled).toHaveBeenCalledTimes(2);
  expect(context[0].active.draggableId).toBeNull();
});

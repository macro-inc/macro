import { createMemo, createRoot, createSignal } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { createSectionReorder } from './create-section-reorder';

type Data = { dndScope: string; section: string };
type Drag = { draggable: { data: Data }; droppable?: { data: Data } };
const runtime = vi.hoisted(() => ({
  start: (_event: Drag) => {},
  end: (_event: Drag) => {},
  state: {
    active: {
      draggable: undefined as Drag['draggable'] | undefined,
      droppable: undefined as Drag['droppable'],
    },
  },
}));
vi.mock('@thisbeyond/solid-dnd', () => ({
  useDragDropContext: () => [
    runtime.state,
    {
      onDragStart: (callback: (event: Drag) => void) => {
        runtime.start = callback;
      },
      onDragEnd: (callback: (event: Drag) => void) => {
        runtime.end = callback;
      },
    },
  ],
}));
beforeEach(() => {
  runtime.state.active.draggable = undefined;
  runtime.state.active.droppable = undefined;
});

it('scopes edges and writes only visible slots in the host order', () => {
  createRoot((dispose) => {
    const [order, setOrder] = createSignal(['a', 'hidden', 'b', 'c']);
    const keys = () => order().filter((key) => key !== 'hidden');
    const animate = vi.fn((update: () => void) => update());
    const reorder = createSectionReorder({
      keys,
      order,
      setOrder,
      animate,
      account: () => 'viewer',
      scope: 'view',
    });
    const event: Drag = {
      draggable: { data: { dndScope: 'view', section: 'a' } },
      droppable: { data: { dndScope: 'view', section: 'c' } },
    };
    runtime.state.active = {
      draggable: event.draggable,
      droppable: event.droppable,
    };
    expect(reorder.dropEdge('c')).toBe('bottom');
    expect(reorder.isDragging('a')).toBe(true);
    expect(reorder.dropEdge('b')).toBeUndefined();
    runtime.start(event);
    runtime.end(event);
    expect(order()).toEqual(['b', 'hidden', 'c', 'a']);
    reorder.move('a', -1);
    expect(order()).toEqual(['b', 'hidden', 'a', 'c']);
    reorder.move('b', -1);
    reorder.move('c', 1);
    reorder.move('gone', 1);
    expect(animate).toHaveBeenCalledTimes(2);
    dispose();
  });
});

it('rejects cancellation, another scope, missing targets, and an account round trip', () => {
  createRoot((dispose) => {
    const [user, setUser] = createSignal('viewer');
    const account = createMemo(() => ({ user: user() }));
    const [keys, setKeys] = createSignal(['a', 'b']);
    const setOrder = vi.fn();
    const reorder = createSectionReorder({
      keys,
      order: keys,
      setOrder,
      account,
      scope: 'view',
      animate: (update) => update(),
    });
    const event: Drag = {
      draggable: { data: { dndScope: 'view', section: 'a' } },
      droppable: { data: { dndScope: 'view', section: 'b' } },
    };
    runtime.start(event);
    reorder.cancel();
    runtime.end(event);
    runtime.start(event);
    setUser('another');
    setUser('viewer');
    runtime.end(event);
    const foreign: Drag = {
      ...event,
      droppable: { data: { dndScope: 'another-view', section: 'b' } },
    };
    runtime.start(event);
    runtime.state.active = {
      draggable: foreign.draggable,
      droppable: foreign.droppable,
    };
    expect(reorder.dropEdge('b')).toBeUndefined();
    runtime.end(foreign);
    runtime.end({ draggable: event.draggable });
    setKeys(['a']);
    runtime.end(event);
    expect(setOrder).not.toHaveBeenCalled();
    dispose();
  });
});

it('excludes pinned drag sources, targets, and indicators', () => {
  createRoot((dispose) => {
    const keys = () => ['a', 'pinned', 'b', 'c'];
    const setOrder = vi.fn();
    const reorder = createSectionReorder({
      keys,
      order: keys,
      pinned: () => ['pinned'],
      setOrder,
      account: () => 'viewer',
      scope: 'view',
      animate: (update) => update(),
    });
    const pinnedSource: Drag = {
      draggable: { data: { dndScope: 'view', section: 'pinned' } },
      droppable: { data: { dndScope: 'view', section: 'b' } },
    };
    runtime.state.active = {
      draggable: pinnedSource.draggable,
      droppable: pinnedSource.droppable,
    };
    expect(reorder.isDragging('pinned')).toBe(false);
    expect(reorder.dropEdge('b')).toBeUndefined();
    runtime.start(pinnedSource);
    runtime.end(pinnedSource);

    const pinnedTarget: Drag = {
      draggable: { data: { dndScope: 'view', section: 'a' } },
      droppable: { data: { dndScope: 'view', section: 'pinned' } },
    };
    runtime.state.active = {
      draggable: pinnedTarget.draggable,
      droppable: pinnedTarget.droppable,
    };
    expect(reorder.dropEdge('pinned')).toBeUndefined();
    runtime.start(pinnedTarget);
    runtime.end(pinnedTarget);
    reorder.move('pinned', 1);
    expect(setOrder).not.toHaveBeenCalled();
    dispose();
  });
});

it('removes stored pinned keys while preserving hidden non-pinned slots', () => {
  createRoot((dispose) => {
    const [order, setOrder] = createSignal(['a', 'hidden', 'pinned', 'b', 'c']);
    const keys = () => order().filter((key) => key !== 'hidden');
    const reorder = createSectionReorder({
      keys,
      order,
      pinned: () => ['pinned'],
      setOrder,
      account: () => 'viewer',
      scope: 'view',
      animate: (update) => update(),
    });
    expect(reorder.dropEdge('c')).toBeUndefined();
    reorder.move('a', 1);
    expect(order()).toEqual(['b', 'hidden', 'a', 'c']);
    const event: Drag = {
      draggable: { data: { dndScope: 'view', section: 'c' } },
      droppable: { data: { dndScope: 'view', section: 'a' } },
    };
    runtime.start(event);
    runtime.end(event);
    expect(order()).toEqual(['b', 'hidden', 'c', 'a']);
    dispose();
  });
});

import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import {
  DragDropProvider,
  DragDropSensors,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { type Accessor, createSignal, Show } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChannelEntity } from '../types/entity';
import { createEntityDraggable } from './draggable';

vi.mock('@components/app/ItemDragAndDrop', () => ({
  useDragOperation: () => ({ isAltKey: () => false }),
}));

const entity: ChannelEntity = {
  id: 'row',
  type: 'channel',
  channelType: 'private',
  name: 'A channel',
  ownerId: 'owner',
};

function setup(deferUntilInteraction?: Accessor<boolean>) {
  let state!: NonNullable<ReturnType<typeof useDragDropContext>>[0];
  let removeRow!: () => void;
  function Row() {
    const draggable = createEntityDraggable({
      entity,
      splitId: 'split',
      deferUntilInteraction,
    });
    return (
      <div ref={draggable} data-testid="row">
        <span data-testid="child">A channel</span>
      </div>
    );
  }
  function Content() {
    const context = useDragDropContext();
    if (!context) throw new Error('Missing drag provider');
    state = context[0];
    const [mounted, setMounted] = createSignal(true);
    removeRow = () => setMounted(false);
    return (
      <>
        <DragDropSensors />
        <Show when={mounted()}>
          <Row />
        </Show>
      </>
    );
  }
  const view = render(() => (
    <DragDropProvider>
      <Content />
    </DragDropProvider>
  ));
  return { ...view, state, removeRow };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createEntityDraggable', () => {
  it.each([undefined, () => false])(
    'preserves eager legacy registration without opting in (%s)',
    (deferred) => {
      const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
      const { state } = setup(deferred);
      expect(state.draggables['row-split']).toBeDefined();
      expect(rect).toHaveBeenCalled();
    }
  );

  it('does not register or measure opted-in rows until a primary press', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
    const { state, getByTestId } = setup(() => true);
    expect(state.draggables['row-split']).toBeUndefined();
    expect(rect).not.toHaveBeenCalled();

    fireEvent.mouseEnter(getByTestId('row'));
    fireEvent.mouseDown(getByTestId('child'), { button: 2 });
    expect(state.draggables['row-split']).toBeUndefined();
    expect(rect).not.toHaveBeenCalled();

    getByTestId('child').dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0 })
    );
    expect(state.draggables['row-split']?.data.name).toBe('A channel');
    expect(rect).toHaveBeenCalledTimes(1);
    getByTestId('child').dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0 })
    );
    expect(rect).toHaveBeenCalledTimes(1);
  });

  it('starts the first drag without a prior hover or pointerdown', () => {
    vi.useFakeTimers();
    const { state, getByTestId } = setup(() => true);
    fireEvent.mouseDown(getByTestId('child'), {
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.mouseMove(document, { clientX: 40, clientY: 10 });
    expect(state.active.draggableId).toBe('row-split');
    expect(state.active.draggable?.data.dragType).toBe('entity');
    fireEvent.mouseUp(document, { button: 0 });
    expect(state.active.draggableId).toBeNull();
  });

  it('initializes eagerly if a mounted row falls back to the legacy path', () => {
    const [deferred, setDeferred] = createSignal(true);
    const { state } = setup(deferred);
    expect(state.draggables['row-split']).toBeUndefined();
    setDeferred(false);
    expect(state.draggables['row-split']).toBeDefined();
  });

  it('removes handlers when a row is disposed before its first interaction', () => {
    const { state, getByTestId, removeRow } = setup(() => true);
    const row = getByTestId('row');
    removeRow();
    fireEvent.mouseDown(row, { button: 0 });
    expect(state.draggables['row-split']).toBeUndefined();
  });

  it('unregisters an initialized row when its owner is disposed', async () => {
    const { state, getByTestId, removeRow } = setup(() => true);
    getByTestId('row').dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0 })
    );
    expect(state.draggables['row-split']).toBeDefined();
    removeRow();
    await Promise.resolve();
    expect(state.draggables['row-split']).toBeUndefined();
  });
});

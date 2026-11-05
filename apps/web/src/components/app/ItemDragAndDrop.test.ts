import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import {
  createDraggable,
  createDroppable,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { createComponent, type ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ItemDndProvider } from './ItemDragAndDrop';

vi.mock('@core/component/EntityIcon', () => ({
  EntityIcon: () => null,
  getEntityIconType: () => 'channel',
}));
vi.mock('@core/component/FileList/TruncatedText', () => ({
  TruncatedText: (props: ParentProps) => props.children,
}));
vi.mock('@ui', () => ({ Layer: (props: ParentProps) => props.children }));

function setup() {
  let context: NonNullable<ReturnType<typeof useDragDropContext>>;
  let row: HTMLButtonElement;
  const opened = vi.fn();
  const dropped = vi.fn();

  const Row = () => {
    context = useDragDropContext()!;
    const draggable = createDraggable('channel', { name: 'Channel' });
    const droppable = createDroppable('target');
    context[1].onDragEnd(dropped);
    row = document.createElement('button');
    row.textContent = 'Channel';
    row.addEventListener('mousedown', (event) => {
      draggable.dragActivators.onmousedown(event);
    });
    row.addEventListener('click', opened);
    draggable.ref(row);
    droppable.ref(row);
    return row;
  };

  const view = render(() =>
    createComponent(ItemDndProvider, {
      get children() {
        return createComponent(Row, {});
      },
    })
  );
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => row,
  });

  return {
    view,
    row: row!,
    state: context![0],
    opened,
    dropped,
  };
}

afterEach(() => {
  fireEvent.mouseUp(document);
  cleanup();
  Reflect.deleteProperty(document, 'elementFromPoint');
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('workspace drag recovery', () => {
  it.each(['blur', 'pointercancel', 'hidden', 'released button'] as const)(
    'releases an interrupted drag after %s without committing a drop',
    (interruption) => {
      const { row, state, opened, dropped } = setup();
      fireEvent.mouseDown(row, {
        button: 0,
        buttons: 1,
        clientX: 10,
        clientY: 10,
      });
      fireEvent.mouseMove(document, { buttons: 1, clientX: 30, clientY: 10 });
      expect(state.active.draggable?.id).toBe('channel');
      expect(state.active.droppable?.id).toBe('target');

      if (interruption === 'blur') {
        fireEvent(window, new Event('blur'));
      } else if (interruption === 'pointercancel') {
        fireEvent.pointerCancel(row);
      } else if (interruption === 'hidden') {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        fireEvent(document, new Event('visibilitychange'));
      } else {
        fireEvent.mouseMove(document, { buttons: 0, clientX: 40, clientY: 10 });
      }

      expect(state.active.draggable).toBeNull();
      expect(state.active.sensor).toBeNull();
      expect(dropped).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ droppable: null })
      );

      fireEvent.pointerDown(row, { button: 0, buttons: 1 });
      fireEvent.mouseDown(row, {
        button: 0,
        buttons: 1,
        clientX: 10,
        clientY: 10,
      });
      fireEvent.mouseUp(row, { button: 0, buttons: 0 });
      fireEvent.click(row);
      expect(opened).toHaveBeenCalledOnce();

      fireEvent.mouseDown(row, {
        button: 0,
        buttons: 1,
        clientX: 10,
        clientY: 10,
      });
      fireEvent.mouseMove(document, { buttons: 1, clientX: 30, clientY: 10 });
      expect(state.active.draggable?.id).toBe('channel');
      fireEvent.mouseUp(row, { button: 0, buttons: 0 });
      expect(state.active.draggable).toBeNull();
      expect(state.active.sensor).toBeNull();
      expect(dropped).toHaveBeenLastCalledWith(
        expect.objectContaining({
          droppable: expect.objectContaining({ id: 'target' }),
        })
      );
    }
  );

  it('preserves short clicks and hold activation', () => {
    vi.useFakeTimers();
    const { row, state, opened, dropped } = setup();
    fireEvent.mouseDown(row, { button: 0, buttons: 1 });
    vi.advanceTimersByTime(200);
    fireEvent.mouseUp(row, { button: 0 });
    fireEvent.click(row);
    vi.advanceTimersByTime(1000);
    expect(opened).toHaveBeenCalledOnce();
    expect(state.active.sensor).toBeNull();
    expect(dropped).not.toHaveBeenCalled();

    fireEvent.mouseDown(row, { button: 0, buttons: 1 });
    vi.advanceTimersByTime(250);
    expect(state.active.draggable?.id).toBe('channel');
    fireEvent.mouseUp(window, { button: 0 });
    expect(state.active.sensor).toBeNull();
    expect(dropped).toHaveBeenCalledOnce();
  });

  it('clears a pending hold on disposal', () => {
    vi.useFakeTimers();
    const { row, view, state, dropped } = setup();
    fireEvent.mouseDown(row, { button: 0, buttons: 1 });
    view.unmount();
    vi.advanceTimersByTime(1000);
    expect(state.active.sensor).toBeNull();
    expect(dropped).not.toHaveBeenCalled();
  });
  it('does not start a held press after the window loses focus', () => {
    vi.useFakeTimers();
    const { row, state, dropped } = setup();
    fireEvent.mouseDown(row, { button: 0, buttons: 1 });
    fireEvent(window, new Event('blur'));
    vi.advanceTimersByTime(1000);
    expect(state.active.draggable).toBeNull();
    expect(state.active.sensor).toBeNull();
    expect(dropped).not.toHaveBeenCalled();
  });
});

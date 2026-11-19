import { fireEvent, render, screen } from '@solidjs/testing-library';
import {
  createDraggable,
  createDroppable,
  DragDropProvider,
  DragOverlay,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ItemDndProvider, useDragOperation } from './ItemDragAndDrop';
import { createItemDragSensor } from './item-drag-sensor';

function mousePointer(type: string, options: PointerEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, ...options });
  Object.defineProperties(event, {
    pointerType: { value: options.pointerType ?? 'mouse' },
    pointerId: { value: options.pointerId ?? 1 },
  });
  return event;
}
function mount(onDrop = vi.fn()) {
  let position: { x: number; y: number } | undefined;
  const clear = vi.fn(() => {
    position = undefined;
  });
  const Sensor = () => {
    createItemDragSensor({
      move: (next) => {
        position = next;
      },
      clear,
    });
    return null;
  };
  const Row = () => {
    const draggable = createDraggable('source');
    const droppable = createDroppable('target');
    const [state] = useDragDropContext()!;
    return (
      <>
        <div
          data-testid="source"
          ref={draggable}
          onMouseDown={draggable.dragActivators.onmousedown}
        />
        <div data-testid="target" ref={droppable} />
        <span data-testid="active">
          {state.active.draggable ? 'dragging' : 'idle'}
        </span>
        <span data-testid="sensor">
          {state.active.sensor ? 'active' : 'idle'}
        </span>
        <span data-testid="overlay">
          {state.active.overlay ? 'active' : 'idle'}
        </span>
      </>
    );
  };
  const result = render(() => (
    <DragDropProvider
      collisionDetector={(_, droppables) =>
        position && position.x < 100 ? (droppables[0] ?? null) : null
      }
      onDragEnd={({ droppable }) => {
        if (droppable) onDrop();
      }}
    >
      <Sensor />
      <Row />
      <DragOverlay>preview</DragOverlay>
    </DragDropProvider>
  ));
  const press = () =>
    fireEvent.mouseDown(screen.getByTestId('source'), {
      button: 0,
      clientX: 10,
      clientY: 20,
    });
  const move = (buttons = 1) =>
    fireEvent.mouseMove(window, { buttons, clientX: 30, clientY: 40 });
  const release = () =>
    fireEvent.mouseUp(window, { button: 0, clientX: 30, clientY: 40 });
  return { ...result, press, move, release, clear, onDrop };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('item mouse sensor with solid-dnd', () => {
  it('keeps the primary-button threshold, supports delayed activation, and drops on release', () => {
    vi.useFakeTimers();
    const drag = mount();
    fireEvent.mouseDown(screen.getByTestId('source'), { button: 2 });
    drag.move();
    expect(screen.getByTestId('active').textContent).toBe('idle');
    drag.press();
    fireEvent.mouseMove(window, { buttons: 1, clientX: 16, clientY: 28 });
    expect(screen.getByTestId('active').textContent).toBe('idle');
    vi.advanceTimersByTime(250);
    expect(screen.getByTestId('active').textContent).toBe('dragging');
    drag.release();
    expect(drag.onDrop).toHaveBeenCalledOnce();
    expect(screen.getByTestId('sensor').textContent).toBe('idle');
    expect(screen.getByTestId('overlay').textContent).toBe('idle');
    drag.press();
    const pendingRelease = new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(pendingRelease);
    expect(pendingRelease.defaultPrevented).toBe(false);
    drag.unmount();
  });

  it.each(['pointercancel', 'Escape', 'blur', 'lost buttons'])(
    'cancels %s without a drop and permits the next drag',
    (reason) => {
      vi.useFakeTimers();
      const drag = mount();
      drag.press();
      drag.move();
      expect(screen.getByTestId('active').textContent).toBe('dragging');
      if (reason === 'pointercancel')
        fireEvent(window, mousePointer('pointercancel'));
      if (reason === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
      if (reason === 'blur') fireEvent.blur(window);
      if (reason === 'lost buttons') drag.move(0);
      expect(screen.getByTestId('active').textContent).toBe('idle');
      expect(screen.getByTestId('sensor').textContent).toBe('idle');
      expect(screen.getByTestId('overlay').textContent).toBe('idle');
      drag.release();
      expect(drag.onDrop).not.toHaveBeenCalled();
      drag.press();
      drag.move();
      drag.release();
      expect(drag.onDrop).toHaveBeenCalledOnce();
      drag.unmount();
    }
  );

  it('finishes mouseup even when a child stops propagation', () => {
    const drag = mount();
    const target = screen.getByTestId('target');
    target.addEventListener('mouseup', (event) => event.stopPropagation());
    drag.press();
    drag.move();
    fireEvent.mouseUp(target, { button: 0, clientX: 30, clientY: 40 });
    expect(drag.onDrop).toHaveBeenCalledOnce();
    expect(screen.getByTestId('sensor').textContent).toBe('idle');
    drag.unmount();
  });

  it('cancels a pending activation and never restarts it after release', () => {
    vi.useFakeTimers();
    const drag = mount();
    drag.press();
    fireEvent.keyDown(document, { key: 'Escape' });
    vi.advanceTimersByTime(300);
    drag.move();
    drag.release();
    expect(screen.getByTestId('active').textContent).toBe('idle');
    expect(drag.onDrop).not.toHaveBeenCalled();
    drag.unmount();
  });

  it('does not drop when the mouse releases outside a target', () => {
    const drag = mount();
    drag.press();
    drag.move();
    fireEvent.mouseUp(window, { button: 0, clientX: 500, clientY: 500 });
    expect(drag.onDrop).not.toHaveBeenCalled();
    expect(screen.getByTestId('active').textContent).toBe('idle');
    drag.unmount();
  });

  it('cleans pending activation and active overlays when unmounted', () => {
    vi.useFakeTimers();
    const pending = mount();
    pending.press();
    pending.unmount();
    vi.advanceTimersByTime(300);
    expect(pending.onDrop).not.toHaveBeenCalled();
    const active = mount();
    active.press();
    active.move();
    active.unmount();
    fireEvent.mouseUp(window);
    expect(active.onDrop).not.toHaveBeenCalled();
  });

  it('finishes pointerup outside the document when mouseup does not arrive', async () => {
    vi.useFakeTimers();
    const drag = mount();
    drag.press();
    drag.move();
    fireEvent(
      window,
      mousePointer('pointerup', { clientX: 500, clientY: 500 })
    );
    vi.runOnlyPendingTimers();
    await Promise.resolve();
    expect(screen.getByTestId('active').textContent).toBe('idle');
    expect(screen.getByTestId('sensor').textContent).toBe('idle');
    expect(screen.getByTestId('overlay').textContent).toBe('idle');
    expect(drag.onDrop).not.toHaveBeenCalled();
    drag.unmount();
  });

  it('ignores secondary-button release and touch-pointer termination during a mouse drag', () => {
    vi.useFakeTimers();
    const drag = mount();
    drag.press();
    drag.move();
    fireEvent.mouseUp(window, { button: 2, buttons: 1 });
    fireEvent(
      window,
      mousePointer('pointerup', { pointerType: 'touch', pointerId: 2 })
    );
    fireEvent(
      window,
      mousePointer('pointercancel', { pointerType: 'touch', pointerId: 2 })
    );
    vi.runOnlyPendingTimers();
    expect(screen.getByTestId('active').textContent).toBe('dragging');
    expect(drag.onDrop).not.toHaveBeenCalled();
    drag.release();
    expect(drag.onDrop).toHaveBeenCalledOnce();
    drag.unmount();
  });

  it('captures an activated mouse pointer and cancels when capture is lost', () => {
    const drag = mount();
    const row = screen.getByTestId('source');
    const capture = vi.fn();
    const release = vi.fn();
    Object.assign(row, {
      setPointerCapture: capture,
      hasPointerCapture: () => true,
      releasePointerCapture: release,
    });
    fireEvent(row, mousePointer('pointerdown'));
    drag.press();
    expect(capture).not.toHaveBeenCalled();
    drag.move();
    expect(capture).toHaveBeenCalledWith(1);
    fireEvent(row, mousePointer('lostpointercapture'));
    expect(screen.getByTestId('active').textContent).toBe('idle');
    expect(drag.onDrop).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(1);
    drag.unmount();
  });

  it('does not deliver a scheduled pointerup after unmount', () => {
    vi.useFakeTimers();
    const drag = mount();
    drag.press();
    drag.move();
    fireEvent(window, mousePointer('pointerup'));
    drag.unmount();
    vi.runOnlyPendingTimers();
    expect(drag.onDrop).not.toHaveBeenCalled();
  });

  it('cleans the sensor and overlay when a drag-end subscriber throws', () => {
    const target: EventTarget = window;
    const listeners = vi.spyOn(target, 'addEventListener');
    const drag = mount(
      vi.fn(() => {
        throw new Error('drop failed');
      })
    );
    drag.press();
    drag.move();
    const up = listeners.mock.calls.find(([type]) => type === 'mouseup')?.[1];
    if (typeof up !== 'function') throw new Error('Missing mouseup listener');
    expect(() =>
      up.call(
        window,
        new MouseEvent('mouseup', { button: 0, clientX: 30, clientY: 40 })
      )
    ).toThrow('drop failed');
    expect(screen.getByTestId('active').textContent).toBe('idle');
    expect(screen.getByTestId('sensor').textContent).toBe('idle');
    expect(screen.getByTestId('overlay').textContent).toBe('idle');
    listeners.mockRestore();
    drag.unmount();
  });
});

describe('ItemDndProvider', () => {
  it('keeps the Alt copy operation through drag-end subscribers', () => {
    const operations: string[] = [];
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => document.body,
    });
    const Row = () => {
      const { isAltKey } = useDragOperation();
      const draggable = createDraggable('source', {
        operation: () => (isAltKey() ? 'copy' : 'move'),
      });
      const [, actions] = useDragDropContext()!;
      actions.onDragEnd(({ draggable }) => {
        operations.push(draggable.data.operation());
      });
      return (
        <div
          data-testid="source"
          ref={draggable}
          onMouseDown={draggable.dragActivators.onmousedown}
        />
      );
    };
    try {
      const view = render(() => (
        <ItemDndProvider>
          <Row />
        </ItemDndProvider>
      ));
      fireEvent.keyDown(window, { key: 'Alt', altKey: true });
      fireEvent.mouseDown(screen.getByTestId('source'), {
        button: 0,
        clientX: 10,
        clientY: 20,
      });
      fireEvent.mouseMove(window, { buttons: 1, clientX: 30, clientY: 40 });
      fireEvent.mouseUp(window, { button: 0, clientX: 30, clientY: 40 });
      expect(operations).toEqual(['copy']);
      fireEvent.mouseDown(screen.getByTestId('source'), {
        button: 0,
        clientX: 10,
        clientY: 20,
      });
      fireEvent.mouseMove(window, { buttons: 1, clientX: 30, clientY: 40 });
      fireEvent.mouseUp(window, { button: 0, clientX: 30, clientY: 40 });
      expect(operations).toEqual(['copy', 'copy']);
      view.unmount();
    } finally {
      Reflect.deleteProperty(document, 'elementFromPoint');
    }
  });
});

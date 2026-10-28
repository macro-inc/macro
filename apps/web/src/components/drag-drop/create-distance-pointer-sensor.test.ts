import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDistancePointerSensor } from './create-distance-pointer-sensor';

const mock = vi.hoisted(() => {
  let activator: ((event: MouseEvent, id: string | number) => void) | undefined;
  let sensorId: string | null = null;
  let draggable: object | null = null;
  const actions = {
    addSensor: vi.fn(
      (sensor: { activators: { mousedown: typeof activator } }) => {
        activator = sensor.activators.mousedown;
      }
    ),
    removeSensor: vi.fn(),
    sensorStart: vi.fn((id: string) => {
      sensorId = id;
    }),
    sensorMove: vi.fn(),
    sensorEnd: vi.fn(() => {
      sensorId = null;
    }),
    dragStart: vi.fn(() => {
      draggable = {};
    }),
    dragEnd: vi.fn(() => {
      draggable = null;
    }),
  };
  return {
    actions,
    state: {
      active: {
        get sensorId() {
          return sensorId;
        },
        get sensor() {
          return sensorId ? {} : null;
        },
        get draggable() {
          return draggable;
        },
      },
    },
    press: (event: MouseEvent, id: string | number) => activator?.(event, id),
    reset: () => {
      activator = undefined;
      sensorId = null;
      draggable = null;
    },
  };
});
vi.mock('@thisbeyond/solid-dnd', () => ({
  useDragDropContext: () => [mock.state, mock.actions],
}));

let dispose: (() => void) | undefined;
const onCancel = vi.fn();
function setup(distance = 10) {
  let sensor!: ReturnType<typeof createDistancePointerSensor>;
  createRoot((cleanup) => {
    dispose = cleanup;
    sensor = createDistancePointerSensor(distance, onCancel);
  });
  const press = (x = 10, y = 20, button = 0) =>
    mock.press(
      new MouseEvent('mousedown', { clientX: x, clientY: y, button }),
      'item'
    );
  const move = (x: number, y: number) => {
    const event = new MouseEvent('mousemove', {
      clientX: x,
      clientY: y,
      cancelable: true,
    });
    document.dispatchEvent(event);
    return event;
  };
  const up = () => {
    const event = new MouseEvent('mouseup', { cancelable: true });
    document.dispatchEvent(event);
    return event;
  };
  return { sensor, press, move, up };
}
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  mock.reset();
  for (const action of Object.values(mock.actions)) action.mockClear();
  onCancel.mockClear();
});

describe('distance-only mouse sensor', () => {
  it('ignores other buttons, time, and movement up to the threshold', () => {
    vi.useFakeTimers();
    const { press, move, up } = setup();
    press(10, 20, 2);
    move(100, 100);
    expect(mock.actions.dragStart).not.toHaveBeenCalled();
    press();
    vi.advanceTimersByTime(5000);
    move(16, 28);
    expect(mock.actions.dragStart).not.toHaveBeenCalled();
    expect(up().defaultPrevented).toBe(false);
    expect(mock.actions.dragStart).not.toHaveBeenCalled();
  });

  it('starts beyond the threshold with the press coordinates and clears selection', () => {
    const selection = vi.spyOn(window, 'getSelection');
    const removeAllRanges = vi.fn();
    selection.mockReturnValue({ removeAllRanges } as unknown as Selection);
    const { press, move, up } = setup();
    press();
    expect(move(16, 29).defaultPrevented).toBe(true);
    expect(mock.actions.sensorStart).toHaveBeenCalledWith(
      'distance-pointer-sensor',
      { x: 10, y: 20 }
    );
    expect(mock.actions.dragStart).toHaveBeenCalledWith('item');
    expect(mock.actions.sensorMove).toHaveBeenCalledWith({ x: 16, y: 29 });
    document.dispatchEvent(new Event('selectionchange'));
    expect(removeAllRanges).toHaveBeenCalledTimes(2);
    expect(up().defaultPrevented).toBe(true);
    expect(mock.actions.dragEnd).toHaveBeenCalledTimes(1);
    expect(mock.actions.sensorEnd).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('selectionchange'));
    expect(removeAllRanges).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending press and does not activate on later movement', () => {
    const { sensor, press, move, up } = setup();
    press();
    expect(sensor.cancel()).toBe(true);
    expect(sensor.cancel()).toBe(false);
    move(100, 100);
    up();
    expect(mock.actions.dragStart).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    press();
    move(100, 100);
    expect(mock.actions.dragStart).toHaveBeenCalledTimes(1);
  });

  it('does not restart a cancelled drag until mouseup, then permits a new press', () => {
    const { sensor, press, move, up } = setup();
    press();
    move(100, 100);
    expect(sensor.cancel()).toBe(true);
    move(120, 120);
    expect(mock.actions.dragStart).toHaveBeenCalledTimes(1);
    expect(mock.actions.sensorMove).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mock.actions.dragEnd).toHaveBeenCalledTimes(1);
    up();
    expect(mock.actions.sensorEnd).toHaveBeenCalledTimes(1);
    press();
    move(100, 100);
    expect(mock.actions.dragStart).toHaveBeenCalledTimes(2);
  });

  it('releases the sensor on blur and cancels active work on cleanup', () => {
    const { sensor, press, move } = setup();
    press();
    move(100, 100);
    expect(sensor.cancel(true)).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mock.actions.sensorEnd).toHaveBeenCalledTimes(1);
    press();
    move(100, 100);
    dispose?.();
    dispose = undefined;
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(mock.actions.removeSensor).toHaveBeenCalledWith(
      'distance-pointer-sensor'
    );
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(mock.actions.sensorEnd).toHaveBeenCalledTimes(2);
  });

  it('releases a pending press on blur and cleans its listeners on disposal', () => {
    const { sensor, press, move } = setup();
    press();
    expect(sensor.cancel(true)).toBe(true);
    move(100, 100);
    expect(mock.actions.dragStart).not.toHaveBeenCalled();
    press();
    dispose?.();
    dispose = undefined;
    move(100, 100);
    expect(mock.actions.dragStart).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(mock.actions.removeSensor).toHaveBeenCalledTimes(1);
  });

  it('does not cancel twice when disposal follows Escape', () => {
    const { sensor, press, move } = setup();
    press();
    move(100, 100);
    sensor.cancel();
    dispose?.();
    dispose = undefined;
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mock.actions.dragEnd).toHaveBeenCalledTimes(1);
    expect(mock.actions.sensorEnd).toHaveBeenCalledTimes(1);
  });
});

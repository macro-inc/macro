import { describe, expect, it } from 'vitest';
import { FIT_VIEWPORT, type ViewGeometry } from './geometry';
import {
  type GestureContext,
  type GestureEffect,
  type GestureEvent,
  type GestureState,
  INITIAL_GESTURE_STATE,
  rfbButtons,
  stepGesture,
} from './gestures';

// 960x540 viewer showing a 1920x1080 guest at scale 0.5: guest = 2 x viewer.
const GEOMETRY: ViewGeometry = {
  container: { width: 960, height: 540 },
  frame: { width: 1920, height: 1080 },
  rotation: 0,
};

const DRIVING: GestureContext = {
  geometry: GEOMETRY,
  viewport: FIT_VIEWPORT,
  sendsInput: true,
  touchMode: 'touch',
};

const WATCHING: GestureContext = { ...DRIVING, sendsInput: false };

/** Feeds events through the machine, applying viewport effects like the viewer does. */
function run(
  events: GestureEvent[],
  context: GestureContext
): { effects: GestureEffect[]; state: GestureState; context: GestureContext } {
  let state = INITIAL_GESTURE_STATE;
  let current = context;
  const effects: GestureEffect[] = [];
  for (const event of events) {
    const result = stepGesture(state, event, current);
    state = result.state;
    for (const effect of result.effects) {
      effects.push(effect);
      if (effect.type === 'viewport') {
        current = { ...current, viewport: effect.viewport };
      }
    }
  }
  return { effects, state, context: current };
}

describe('touch while driving', () => {
  it('taps a left click at the guest pixel under the finger', () => {
    const { effects } = run(
      [
        {
          type: 'down',
          pointer: { id: 1, kind: 'touch', x: 100, y: 50, buttons: 1, time: 0 },
        },
        {
          type: 'up',
          pointer: {
            id: 1,
            kind: 'touch',
            x: 103,
            y: 52,
            buttons: 0,
            time: 80,
          },
        },
      ],
      DRIVING
    );
    expect(effects).toEqual([
      { type: 'armLongPress', id: 1 },
      { type: 'cancelLongPress' },
      { type: 'input', event: { kind: 'pointer', x: 200, y: 100, buttons: 0 } },
      { type: 'input', event: { kind: 'pointer', x: 200, y: 100, buttons: 1 } },
      { type: 'input', event: { kind: 'pointer', x: 200, y: 100, buttons: 0 } },
    ]);
  });

  it('drags with the left button from where the finger went down', () => {
    const { effects } = run(
      [
        {
          type: 'down',
          pointer: { id: 1, kind: 'touch', x: 100, y: 50, buttons: 1, time: 0 },
        },
        {
          type: 'move',
          pointer: {
            id: 1,
            kind: 'touch',
            x: 130,
            y: 50,
            buttons: 1,
            time: 50,
          },
        },
        {
          type: 'move',
          pointer: {
            id: 1,
            kind: 'touch',
            x: 160,
            y: 60,
            buttons: 1,
            time: 90,
          },
        },
        {
          type: 'up',
          pointer: {
            id: 1,
            kind: 'touch',
            x: 160,
            y: 60,
            buttons: 0,
            time: 120,
          },
        },
      ],
      DRIVING
    );
    expect(effects).toEqual([
      { type: 'armLongPress', id: 1 },
      { type: 'cancelLongPress' },
      { type: 'input', event: { kind: 'pointer', x: 200, y: 100, buttons: 0 } },
      { type: 'input', event: { kind: 'pointer', x: 200, y: 100, buttons: 1 } },
      { type: 'input', event: { kind: 'pointer', x: 260, y: 100, buttons: 1 } },
      { type: 'input', event: { kind: 'pointer', x: 320, y: 120, buttons: 1 } },
      { type: 'input', event: { kind: 'pointer', x: 320, y: 120, buttons: 0 } },
    ]);
  });

  it('right-clicks on a long press and ignores the lift', () => {
    const { effects } = run(
      [
        {
          type: 'down',
          pointer: { id: 1, kind: 'touch', x: 100, y: 50, buttons: 1, time: 0 },
        },
        { type: 'longPress', id: 1 },
        {
          type: 'up',
          pointer: {
            id: 1,
            kind: 'touch',
            x: 100,
            y: 50,
            buttons: 0,
            time: 700,
          },
        },
      ],
      DRIVING
    );
    expect(effects).toEqual([
      { type: 'armLongPress', id: 1 },
      { type: 'input', event: { kind: 'pointer', x: 200, y: 100, buttons: 0 } },
      { type: 'input', event: { kind: 'pointer', x: 200, y: 100, buttons: 4 } },
      { type: 'input', event: { kind: 'pointer', x: 200, y: 100, buttons: 0 } },
    ]);
  });

  it('scrolls the guest with one finger in scroll mode, one notch per 40 px', () => {
    // The finger moves up 90 px, 10 px per event.
    const swipe: GestureEvent[] = Array.from({ length: 9 }, (_, index) => ({
      type: 'move',
      pointer: {
        id: 1,
        kind: 'touch',
        x: 400,
        y: 290 - index * 10,
        buttons: 1,
        time: (index + 1) * 10,
      },
    }));
    const { effects } = run(
      [
        {
          type: 'down',
          pointer: {
            id: 1,
            kind: 'touch',
            x: 400,
            y: 300,
            buttons: 1,
            time: 0,
          },
        },
        ...swipe,
        {
          type: 'up',
          pointer: {
            id: 1,
            kind: 'touch',
            x: 400,
            y: 210,
            buttons: 0,
            time: 100,
          },
        },
      ],
      { ...DRIVING, touchMode: 'scroll' }
    );
    expect(effects).toEqual([
      {
        type: 'input',
        event: { kind: 'scroll', x: 800, y: 600, dx: 0, dy: 1 },
      },
      {
        type: 'input',
        event: { kind: 'scroll', x: 800, y: 600, dx: 0, dy: 1 },
      },
    ]);
  });

  it('pans the view with one finger in view mode', () => {
    const { effects, context } = run(
      [
        {
          type: 'down',
          pointer: {
            id: 1,
            kind: 'touch',
            x: 500,
            y: 300,
            buttons: 1,
            time: 0,
          },
        },
        {
          type: 'move',
          pointer: {
            id: 1,
            kind: 'touch',
            x: 450,
            y: 280,
            buttons: 1,
            time: 40,
          },
        },
        {
          type: 'up',
          pointer: {
            id: 1,
            kind: 'touch',
            x: 450,
            y: 280,
            buttons: 0,
            time: 60,
          },
        },
      ],
      { ...DRIVING, touchMode: 'view', viewport: { zoom: 2, panX: 0, panY: 0 } }
    );
    expect(effects.some((effect) => effect.type === 'input')).toBe(false);
    expect(context.viewport).toEqual({ zoom: 2, panX: -50, panY: -20 });
  });

  it('zooms the viewport on a pinch and sends nothing to the guest', () => {
    const { effects, context } = run(
      [
        {
          type: 'down',
          pointer: {
            id: 1,
            kind: 'touch',
            x: 380,
            y: 270,
            buttons: 1,
            time: 0,
          },
        },
        {
          type: 'down',
          pointer: {
            id: 2,
            kind: 'touch',
            x: 580,
            y: 270,
            buttons: 1,
            time: 5,
          },
        },
        {
          type: 'move',
          pointer: {
            id: 1,
            kind: 'touch',
            x: 280,
            y: 270,
            buttons: 1,
            time: 30,
          },
        },
        {
          type: 'move',
          pointer: {
            id: 2,
            kind: 'touch',
            x: 680,
            y: 270,
            buttons: 1,
            time: 35,
          },
        },
      ],
      DRIVING
    );
    expect(effects.some((effect) => effect.type === 'input')).toBe(false);
    // The fingers went from 200 to 400 px apart.
    expect(context.viewport.zoom).toBeCloseTo(2);
  });

  it('releases a guest drag when a second finger lands', () => {
    const { effects } = run(
      [
        {
          type: 'down',
          pointer: { id: 1, kind: 'touch', x: 100, y: 50, buttons: 1, time: 0 },
        },
        {
          type: 'move',
          pointer: {
            id: 1,
            kind: 'touch',
            x: 130,
            y: 50,
            buttons: 1,
            time: 50,
          },
        },
        {
          type: 'down',
          pointer: {
            id: 2,
            kind: 'touch',
            x: 300,
            y: 50,
            buttons: 1,
            time: 60,
          },
        },
      ],
      DRIVING
    );
    expect(effects.at(-1)).toEqual({
      type: 'input',
      event: { kind: 'pointer', x: 260, y: 100, buttons: 0 },
    });
  });
});

describe('touch while watching', () => {
  it('pans a zoomed view with one finger and never sends input', () => {
    const { effects, context } = run(
      [
        {
          type: 'down',
          pointer: {
            id: 1,
            kind: 'touch',
            x: 500,
            y: 300,
            buttons: 1,
            time: 0,
          },
        },
        {
          type: 'move',
          pointer: {
            id: 1,
            kind: 'touch',
            x: 450,
            y: 280,
            buttons: 1,
            time: 40,
          },
        },
        {
          type: 'up',
          pointer: {
            id: 1,
            kind: 'touch',
            x: 450,
            y: 280,
            buttons: 0,
            time: 60,
          },
        },
      ],
      { ...WATCHING, viewport: { zoom: 2, panX: 0, panY: 0 } }
    );
    expect(effects.some((effect) => effect.type === 'input')).toBe(false);
    expect(context.viewport).toEqual({ zoom: 2, panX: -50, panY: -20 });
  });

  it('toggles zoom on a double tap', () => {
    const tap = (time: number): GestureEvent[] => [
      {
        type: 'down',
        pointer: { id: time, kind: 'touch', x: 480, y: 270, buttons: 1, time },
      },
      {
        type: 'up',
        pointer: {
          id: time,
          kind: 'touch',
          x: 480,
          y: 270,
          buttons: 0,
          time: time + 40,
        },
      },
    ];
    const zoomedIn = run([...tap(0), ...tap(150)], WATCHING).context;
    expect(zoomedIn.viewport.zoom).toBe(2.5);
    const back = run([...tap(0), ...tap(150)], zoomedIn).context;
    expect(back.viewport).toEqual(FIT_VIEWPORT);
  });
});

describe('mouse', () => {
  it('maps DOM buttons to the RFB mask', () => {
    expect(rfbButtons(1)).toBe(1);
    expect(rfbButtons(2)).toBe(4);
    expect(rfbButtons(4)).toBe(2);
    expect(rfbButtons(3)).toBe(5);
  });

  it('forwards moves and presses while driving, clamping a drag that leaves the frame', () => {
    const { effects } = run(
      [
        {
          type: 'move',
          pointer: { id: 1, kind: 'mouse', x: 10, y: 10, buttons: 0, time: 0 },
        },
        {
          type: 'down',
          pointer: { id: 1, kind: 'mouse', x: 10, y: 10, buttons: 1, time: 10 },
        },
        {
          type: 'move',
          pointer: {
            id: 1,
            kind: 'mouse',
            x: 2000,
            y: 10,
            buttons: 1,
            time: 20,
          },
        },
        {
          type: 'up',
          pointer: {
            id: 1,
            kind: 'mouse',
            x: 2000,
            y: 10,
            buttons: 0,
            time: 30,
          },
        },
      ],
      DRIVING
    );
    expect(effects).toEqual([
      { type: 'input', event: { kind: 'pointer', x: 20, y: 20, buttons: 0 } },
      { type: 'input', event: { kind: 'pointer', x: 20, y: 20, buttons: 1 } },
      { type: 'input', event: { kind: 'pointer', x: 1919, y: 20, buttons: 1 } },
      { type: 'input', event: { kind: 'pointer', x: 1919, y: 20, buttons: 0 } },
    ]);
  });

  it('sends nothing while watching', () => {
    const { effects } = run(
      [
        {
          type: 'move',
          pointer: { id: 1, kind: 'mouse', x: 10, y: 10, buttons: 0, time: 0 },
        },
        {
          type: 'down',
          pointer: { id: 1, kind: 'mouse', x: 10, y: 10, buttons: 1, time: 10 },
        },
        {
          type: 'up',
          pointer: { id: 1, kind: 'mouse', x: 10, y: 10, buttons: 0, time: 30 },
        },
      ],
      WATCHING
    );
    expect(effects).toEqual([]);
  });
});

describe('wheel', () => {
  it('scrolls the guest in whole notches while driving', () => {
    const { effects } = run(
      [
        { type: 'wheel', x: 480, y: 270, dx: 0, dy: 60, ctrlKey: false },
        { type: 'wheel', x: 480, y: 270, dx: 0, dy: 60, ctrlKey: false },
      ],
      DRIVING
    );
    expect(effects).toEqual([
      {
        type: 'input',
        event: { kind: 'scroll', x: 960, y: 540, dx: 0, dy: 1 },
      },
    ]);
  });

  it('zooms locally on Ctrl+wheel even while driving', () => {
    const { effects, context } = run(
      [{ type: 'wheel', x: 480, y: 270, dx: 0, dy: -100, ctrlKey: true }],
      DRIVING
    );
    expect(effects.some((effect) => effect.type === 'input')).toBe(false);
    expect(context.viewport.zoom).toBeCloseTo(Math.E);
  });
});

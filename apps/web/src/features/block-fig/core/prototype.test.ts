import type {
  PrototypeAction,
  PrototypeInfo,
} from '@core/fig-engine/prototype-types';
import { describe, expect, it } from 'vitest';
import {
  clickableHotspots,
  flowOrder,
  flowsOf,
  goTo,
  hotspotAt,
  overlayPosition,
  presentStart,
  replaceInteraction,
  runAction,
  startState,
  stepFlow,
  transitionOf,
} from './prototype';

const action = (over: Partial<PrototypeAction>): PrototypeAction => ({
  connection: 'INTERNAL_NODE',
  navigation: 'NAVIGATE',
  destination: null,
  transition: 'INSTANT_TRANSITION',
  duration: 0.3,
  easing: null,
  url: null,
  openInNewTab: null,
  overlayOffset: null,
  ...over,
});

const frame = (id: string, x: number, w = 100, h = 200) => ({
  id,
  name: id,
  bounds: { x, y: 0, w, h },
  overlay: null,
});

/** A → B → C, B opens the menu, D is unlinked; the flow starts at A. */
const info = (): PrototypeInfo => ({
  start: null,
  flows: [{ frame: 'A', name: 'Main', description: '' }],
  frames: [
    frame('A', 0),
    frame('B', 200),
    frame('C', 400),
    frame('D', 600),
    {
      ...frame('M', 800, 50, 60),
      overlay: {
        position: 'TOP_LEFT',
        closeOnClickOutside: true,
        background: '00000080',
      },
    },
  ],
  hotspots: [
    {
      id: 'a1',
      name: 'Next',
      frame: 'A',
      bounds: { x: 10, y: 10, w: 50, h: 20 },
      interactions: [
        {
          id: 'i1',
          trigger: 'ON_CLICK',
          timeout: null,
          actions: [action({ destination: 'B', transition: 'DISSOLVE' })],
        },
      ],
    },
    {
      id: 'b1',
      name: 'Menu',
      frame: 'B',
      bounds: { x: 210, y: 10, w: 50, h: 20 },
      interactions: [
        {
          id: 'i2',
          trigger: 'ON_CLICK',
          timeout: null,
          actions: [action({ destination: 'M', navigation: 'OVERLAY' })],
        },
      ],
    },
    {
      id: 'b2',
      name: 'Finish',
      frame: 'B',
      bounds: { x: 210, y: 100, w: 50, h: 20 },
      interactions: [
        {
          id: 'i3',
          trigger: 'ON_CLICK',
          timeout: null,
          actions: [action({ destination: 'C' })],
        },
      ],
    },
    {
      id: 'b3',
      name: 'Hover',
      frame: 'B',
      bounds: { x: 210, y: 100, w: 10, h: 10 },
      interactions: [
        {
          id: 'i4',
          trigger: 'ON_HOVER',
          timeout: null,
          actions: [action({ destination: 'C' })],
        },
      ],
    },
  ],
});

describe('flows', () => {
  it('orders a flow by what it reaches, breadth first', () => {
    expect(flowOrder(info(), 'A')).toEqual(['A', 'B', 'C']);
    // A frame the flow reaches presents in that flow.
    expect(flowOrder(info(), 'C')).toEqual(['A', 'B', 'C']);
  });

  it('falls back to every screen in page order', () => {
    expect(flowOrder(info(), 'D')).toEqual(['A', 'B', 'C', 'D', 'M']);
    const none = { ...info(), flows: [] };
    expect(flowOrder(none, 'B')).toEqual(['A', 'B', 'C', 'D', 'M']);
  });

  it('reads the start frame of files from before flows', () => {
    const legacy = { ...info(), flows: [], start: 'B' };
    expect(flowsOf(legacy)).toEqual([{ name: 'Flow 1', frame: 'B' }]);
    expect(flowOrder(legacy, 'B')).toEqual(['B', 'C']);
  });

  it('starts at the selected screen, else the first flow', () => {
    expect(presentStart(info(), 'C')).toBe('C');
    expect(presentStart(info(), 'b1')).toBe('B');
    expect(presentStart(info(), undefined)).toBe('A');
    expect(presentStart({ ...info(), flows: [] }, 'nope')).toBe('A');
  });

  it('steps through the flow, wrapping', () => {
    expect(stepFlow(['A', 'B', 'C'], 'A', 1)).toBe('B');
    expect(stepFlow(['A', 'B', 'C'], 'A', -1)).toBe('C');
    expect(stepFlow(['A', 'B', 'C'], 'Z', 1)).toBe('A');
    expect(stepFlow([], 'A', 1)).toBeUndefined();
  });
});

describe('interactions', () => {
  it('finds the top-most hotspot for a gesture', () => {
    const p = info();
    expect(hotspotAt(p, 'A', 20, 20, 'click')?.hotspot.id).toBe('a1');
    expect(hotspotAt(p, 'A', 100, 100, 'click')).toBeUndefined();
    // The hover hotspot is drawn above the click one but only hovers.
    expect(hotspotAt(p, 'B', 215, 105, 'click')?.hotspot.id).toBe('b2');
    expect(hotspotAt(p, 'B', 215, 105, 'hover')?.hotspot.id).toBe('b3');
    // Only the frame's own hotspots.
    expect(hotspotAt(p, 'B', 20, 20, 'click')).toBeUndefined();
    expect(clickableHotspots(p, 'B').map((h) => h.id)).toEqual(['b1', 'b2']);
  });

  it('navigates, opens and closes overlays, and goes back', () => {
    let s = startState('A');
    const step = (a: PrototypeAction) => {
      const r = runAction(s, a);
      s = r.state;
      return r;
    };
    expect(step(action({ destination: 'B', transition: 'DISSOLVE' })).transition)
      .toEqual({ kind: 'dissolve', duration: 0.3 });
    expect(s).toEqual({ screen: 'B', history: ['A'], overlays: [] });
    step(action({ destination: 'M', navigation: 'OVERLAY' }));
    expect(s.overlays.map((o) => o.frame)).toEqual(['M']);
    step(action({ destination: 'D', navigation: 'SWAP' }));
    expect(s.overlays.map((o) => o.frame)).toEqual(['D']);
    // Back closes the overlay first, then returns.
    step(action({ connection: 'BACK' }));
    expect(s.overlays).toEqual([]);
    expect(step(action({ connection: 'BACK' })).transition.reverse).toBe(true);
    expect(s).toEqual({ screen: 'A', history: [], overlays: [] });
    // Back with nowhere to go, and Close with no overlay, do nothing.
    expect(runAction(s, action({ connection: 'BACK' })).state).toBe(s);
    expect(runAction(s, action({ connection: 'CLOSE' })).state).toBe(s);
  });

  it('opens links and ignores what the player cannot show', () => {
    const s = startState('A');
    expect(
      runAction(s, action({ connection: 'URL', url: 'https://x.test' })).effect
    ).toEqual({ kind: 'open-url', url: 'https://x.test', newTab: true });
    const swap = runAction(
      s,
      action({ destination: 'B', navigation: 'SWAP_STATE' })
    );
    expect(swap.state).toBe(s);
    expect(goTo(s, 'C')).toEqual({ screen: 'C', history: ['A'], overlays: [] });
  });

  it('maps Figma transitions', () => {
    const t = (transition: string) =>
      transitionOf(action({ transition, duration: 0.5 }));
    expect(t('INSTANT_TRANSITION').kind).toBe('instant');
    expect(t('SMART_ANIMATE')).toEqual({ kind: 'dissolve', duration: 0.5 });
    expect(t('MOVE_FROM_RIGHT')).toEqual({
      kind: 'move-in',
      side: 'right',
      duration: 0.5,
    });
    expect(t('PUSH_FROM_LEFT').kind).toBe('push');
    expect(t('SLIDE_FROM_TOP')).toMatchObject({ kind: 'slide', side: 'top' });
    expect(t('MOVE_OUT_TO_BOTTOM')).toMatchObject({
      kind: 'move-out',
      side: 'bottom',
    });
  });

  it('places overlays by their position', () => {
    const p = info();
    const screen = p.frames[1];
    const menu = p.frames[4];
    expect(overlayPosition(menu, screen, { frame: 'M' })).toEqual({ x: 0, y: 0 });
    const centered = { ...menu, overlay: null };
    expect(overlayPosition(centered, screen, { frame: 'M' })).toEqual({
      x: 25,
      y: 70,
    });
    const manual = {
      ...menu,
      overlay: { ...menu.overlay!, position: 'MANUAL' },
    };
    expect(
      overlayPosition(manual, screen, { frame: 'M', offset: { x: 5, y: 6 } })
    ).toEqual({ x: 5, y: 6 });
  });
});

describe('editing', () => {
  it('replaces, appends, and removes interactions, keeping the others', () => {
    const existing = info().hotspots[0].interactions;
    const edited = {
      kind: 'overlay' as const,
      destination: 'M',
      transition: 'DISSOLVE',
      duration: 0.2,
    };
    expect(replaceInteraction(existing, 0, edited)).toEqual([
      {
        id: 'i1',
        trigger: 'ON_CLICK',
        actions: [
          {
            connection: 'INTERNAL_NODE',
            navigation: 'OVERLAY',
            destination: 'M',
            transition: 'DISSOLVE',
            duration: 0.2,
          },
        ],
      },
    ]);
    expect(
      replaceInteraction(existing, 1, { ...edited, kind: 'back' })
    ).toEqual([
      { id: 'i1', actions: [{}] },
      {
        trigger: 'ON_CLICK',
        actions: [
          { connection: 'BACK', transition: 'DISSOLVE', duration: 0.2 },
        ],
      },
    ]);
    expect(replaceInteraction(existing, 0, null)).toEqual([]);
  });

  it('spells out legacy connections (they have no id) when keeping them', () => {
    const legacy = [
      {
        id: null,
        trigger: 'ON_CLICK',
        timeout: null,
        actions: [action({ destination: 'A', transition: 'DISSOLVE' })],
      },
    ];
    expect(replaceInteraction(legacy, 1, null)).toEqual([
      {
        trigger: 'ON_CLICK',
        actions: [
          {
            connection: 'INTERNAL_NODE',
            navigation: 'NAVIGATE',
            destination: 'A',
            transition: 'DISSOLVE',
            duration: 0.3,
          },
        ],
      },
    ]);
  });
});

import type {
  AnimationOutline,
  ShapeOutline,
  SlideOutline,
} from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import { effectFrames, pathPoints, restingClip } from './animation-effects';
import {
  buildTimeline,
  clickSteps,
  groupLength,
  statesAfter,
} from './animation-timeline';

const SLIDE = { w: 960, h: 540 };

const shape = (id: number, x: number, children?: ShapeOutline[]) =>
  ({
    id,
    name: `Shape ${id}`,
    kind: children ? 'group' : 'shape',
    x,
    y: 100,
    w: 100,
    h: 50,
    rotation: 0,
    flipH: false,
    flipV: false,
    hidden: false,
    textEditable: true,
    children,
  }) as ShapeOutline;

const anim = (
  shapeId: number,
  patch: Partial<AnimationOutline> = {}
): AnimationOutline => ({
  shapeId,
  class: 'entrance',
  effect: 'fade',
  presetId: 10,
  presetSubtype: 0,
  start: 'onClick',
  durationMs: 500,
  delayMs: 0,
  ...patch,
});

const slide = (
  shapes: ShapeOutline[],
  animations: AnimationOutline[]
): SlideOutline => ({
  id: 256,
  index: 0,
  layout: 'Blank',
  hidden: false,
  shapes,
  animations,
});

describe('animation timeline', () => {
  it('splits the slide into static runs and animated layers in z-order', () => {
    const s = slide(
      [shape(2, 0), shape(3, 100), shape(4, 200), shape(5, 300)],
      [anim(3), anim(5, { start: 'withPrevious' })]
    );
    const t = buildTimeline(s);
    expect(t.layers).toEqual([
      { start: 0, end: 1, backdrop: true },
      { start: 1, end: 2, backdrop: false, shapeId: 3 },
      { start: 2, end: 3, backdrop: false },
      { start: 3, end: 4, backdrop: false, shapeId: 5 },
    ]);
    expect(t.pieces.map((p) => p.key)).toEqual(['3', '5']);
  });

  it('keeps a backdrop layer when the backmost shape is animated', () => {
    const t = buildTimeline(slide([shape(2, 0)], [anim(2)]));
    expect(t.layers[0]).toEqual({ start: 0, end: 0, backdrop: true });
  });

  it('times with-previous and after-previous animations', () => {
    const t = buildTimeline(
      slide(
        [shape(2, 0), shape(3, 100), shape(4, 200)],
        [
          anim(2, { start: 'withPrevious', delayMs: 100 }),
          anim(3),
          anim(4, { start: 'withPrevious', delayMs: 250 }),
          anim(2, {
            class: 'emphasis',
            effect: 'spin',
            start: 'afterPrevious',
            durationMs: 2000,
          }),
        ]
      )
    );
    expect(clickSteps(t)).toBe(1);
    expect(t.groups[0].map((a) => a.start)).toEqual([100]);
    expect(t.groups[1].map((a) => a.start)).toEqual([0, 250, 750]);
    expect(groupLength(t.groups[1])).toBe(2750);
  });

  it('hides entrance pieces until they play and keeps lasting effects', () => {
    const t = buildTimeline(
      slide(
        [shape(2, 0), shape(3, 100)],
        [
          anim(2),
          anim(2, { class: 'emphasis', effect: 'growShrink' }),
          anim(3, { class: 'exit', effect: 'fadeOut' }),
          anim(2, { class: 'path', effect: 'path', path: 'M 0 0 L 0.5 0 E' }),
        ]
      )
    );
    const before = statesAfter(t, 0, SLIDE);
    expect(before.get('2')?.visible).toBe(false);
    expect(before.get('3')?.visible).toBe(true);
    const after = statesAfter(t, clickSteps(t), SLIDE);
    expect(after.get('2')).toMatchObject({
      visible: true,
      scale: 1.5,
      dx: 480,
    });
    expect(after.get('3')?.visible).toBe(false);
  });

  it('builds paragraphs as clipped pieces when their boxes are known', () => {
    const s = slide(
      [shape(2, 0)],
      [anim(2, { paragraph: 0 }), anim(2, { paragraph: 1 })]
    );
    const boxes = new Map([
      [
        2,
        [
          { x: 0, y: 100, w: 100, h: 20 },
          { x: 0, y: 120, w: 100, h: 20 },
        ],
      ],
    ]);
    const t = buildTimeline(s, boxes);
    expect(t.pieces.map((p) => p.key)).toEqual(['2:0', '2:1', '2:rest']);
    expect(t.groups[1][0].piece).toBe('2:0');
    expect(restingClip(t.pieces[0], SLIDE, 1)).toBe(
      'inset(100.00px 860.00px 420.00px 0.00px)'
    );
    expect(restingClip(t.pieces[2], SLIDE, 1)).toMatch(/^path\(evenodd/);
    // Without boxes the shape animates whole.
    expect(buildTimeline(s).pieces.map((p) => p.key)).toEqual(['2']);
  });

  it('animates a group member with its group', () => {
    const t = buildTimeline(
      slide([shape(10, 0, [shape(11, 0), shape(12, 50)])], [anim(12)])
    );
    expect(t.pieces.map((p) => p.key)).toEqual(['10']);
    expect(t.groups[1][0].piece).toBe('10');
  });
});

describe('animation effects', () => {
  const state = {
    visible: true,
    dx: 0,
    dy: 0,
    scale: 1,
    opacity: 1,
    filter: '',
  };
  const piece = {
    key: '2',
    layer: 1,
    shapeId: 2,
    box: { x: 100, y: 100, w: 100, h: 50 },
  };

  it('flies in from the edge it names and exits backwards', () => {
    const flyIn = effectFrames(
      anim(2, { effect: 'flyIn', direction: 'left' }),
      piece,
      state,
      SLIDE,
      1
    );
    expect(flyIn?.keyframes[0].transform).toContain('translate(-200px, 0px)');
    const flyOut = effectFrames(
      anim(2, { class: 'exit', effect: 'flyOut', direction: 'bottom' }),
      piece,
      state,
      SLIDE,
      1
    );
    expect(flyOut?.keyframes.at(-1)?.transform).toContain(
      'translate(0px, 440px)'
    );
  });

  it('wipes with a clip and carries lasting offsets', () => {
    const wipe = effectFrames(
      anim(2, { effect: 'wipe', direction: 'left' }),
      piece,
      { ...state, dx: 10 },
      SLIDE,
      2
    );
    expect(wipe?.keyframes[0].clipPath).toBe(
      'inset(200.00px 1720.00px 780.00px 200.00px)'
    );
    expect(wipe?.keyframes[0].transform).toContain('translate(20px, 0px)');
    expect(
      effectFrames(
        anim(2, { effect: 'appear', durationMs: 0 }),
        piece,
        state,
        SLIDE,
        1
      )
    ).toBeUndefined();
  });

  it('samples motion paths', () => {
    expect(pathPoints('M 0 0 L 0.25 0.5 E')).toEqual([
      { x: 0, y: 0 },
      { x: 0.25, y: 0.5 },
    ]);
    expect(pathPoints('M 0 0 C 0 0.1 0.1 0.1 0.1 0 E')).toHaveLength(13);
  });
});

import type {
  ShapeOutline,
  SlideOutline,
  TextLayoutInfo,
} from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import {
  matchUnits,
  morphFrames,
  morphPlan,
  spriteRect,
  textOnly,
  textUnits,
  turn,
} from './morph';

let nextId = 1;
function shape(over: Partial<ShapeOutline>): ShapeOutline {
  return {
    id: nextId++,
    name: 'Shape',
    kind: 'shape',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    rotation: 0,
    flipH: false,
    flipV: false,
    hidden: false,
    textEditable: true,
    ...over,
  } as ShapeOutline;
}

function slide(shapes: ShapeOutline[]): SlideOutline {
  return { id: 256, index: 0, layout: '', hidden: false, shapes } as never;
}

describe('morphPlan', () => {
  it('pairs objects by name and kind, as a duplicated slide keeps them', () => {
    const a = shape({ name: 'Rectangle 3' });
    const b = shape({ name: 'Rectangle 3', x: 200 });
    const gone = shape({ name: 'Oval 4', geometry: 'ellipse' });
    const fresh = shape({ name: 'Star 5' });
    const plan = morphPlan(slide([a, gone]), slide([fresh, b]));
    expect(plan.pairs).toEqual([{ from: a, to: b }]);
    expect(plan.leaving).toEqual([gone]);
    expect(plan.entering).toEqual([fresh]);
  });

  it('pairs !! names first, even across kinds', () => {
    const a = shape({ name: '!!Hero', kind: 'picture' });
    const decoy = shape({ name: 'Hero' });
    const b = shape({ name: '!!Hero' });
    const plan = morphPlan(slide([decoy, a]), slide([b]));
    expect(plan.pairs).toEqual([{ from: a, to: b }]);
    expect(plan.leaving).toEqual([decoy]);
  });

  it('falls back to the same text, then the same placeholder', () => {
    const t1 = shape({
      name: 'TextBox 2',
      paragraphs: [{ text: 'Revenue', level: 0 }],
    } as Partial<ShapeOutline>);
    const t2 = shape({
      name: 'TextBox 9',
      paragraphs: [{ text: 'Revenue', level: 0 }],
    } as Partial<ShapeOutline>);
    const p1 = shape({ name: 'Title 1', placeholder: 'title' });
    const p2 = shape({ name: 'Title A', placeholder: 'title' });
    const plan = morphPlan(slide([t1, p1]), slide([p2, t2]));
    expect(plan.pairs).toEqual([
      { from: p1, to: p2 },
      { from: t1, to: t2 },
    ]);
    expect(plan.leaving).toEqual([]);
    expect(plan.entering).toEqual([]);
  });

  it('matches each object once and skips hidden or held-back ones', () => {
    const a1 = shape({ name: 'Box' });
    const a2 = shape({ name: 'Box' });
    const hidden = shape({ name: 'Ghost', hidden: true });
    const b1 = shape({ name: 'Box' });
    const b2 = shape({ name: 'Box' });
    const b3 = shape({ name: 'Box' });
    const ghost = shape({ name: 'Ghost' });
    const plan = morphPlan(
      slide([a1, a2, hidden]),
      slide([b1, b2, b3, ghost]),
      new Set(),
      new Set([b3.id])
    );
    expect(plan.pairs).toEqual([
      { from: a1, to: b1 },
      { from: a2, to: b2 },
    ]);
    expect(plan.entering).toEqual([ghost]);
  });
});

describe('spriteRect', () => {
  it('covers the rotated box and a margin, clipped to the slide', () => {
    expect(
      spriteRect(
        { x: 100, y: 100, w: 100, h: 50, rotation: 0 },
        { w: 960, h: 540 },
        10
      )
    ).toEqual({ x: 90, y: 90, w: 120, h: 70 });
    const r = spriteRect(
      { x: 100, y: 100, w: 100, h: 50, rotation: 90 },
      { w: 960, h: 540 },
      0
    )!;
    expect(r.x).toBeCloseTo(125);
    expect(r.y).toBeCloseTo(75);
    expect(r.w).toBeCloseTo(50);
    expect(r.h).toBeCloseTo(100);
    expect(
      spriteRect(
        { x: -40, y: 10, w: 100, h: 50, rotation: 0 },
        { w: 960, h: 540 },
        0
      )
    ).toEqual({ x: 0, y: 10, w: 60, h: 50 });
    expect(
      spriteRect(
        { x: 1000, y: 10, w: 100, h: 50, rotation: 0 },
        { w: 960, h: 540 }
      )
    ).toBeUndefined();
  });
});

describe('morphFrames', () => {
  const box = { flipH: false, flipV: false };
  it('turns the short way round', () => {
    expect(turn(350, 10)).toBe(20);
    expect(turn(10, 350)).toBe(-20);
    expect(turn(0, 180)).toBe(180);
  });

  it('moves, scales, and rotates about the center', () => {
    const [start, end] = morphFrames(
      { ...box, x: 0, y: 0, w: 100, h: 50, rotation: 350 },
      { ...box, x: 100, y: 50, w: 200, h: 25, rotation: 10 },
      2
    );
    expect(start).toBe(
      'translate(0px, 0px) rotate(350deg) scale(1, 1) rotate(-350deg)'
    );
    // Centers (50, 25) → (200, 62.5); 2 px per point.
    expect(end).toBe(
      'translate(300px, 75px) rotate(370deg) scale(2, 0.5) rotate(-350deg)'
    );
  });

  it('mirrors when a flip changes', () => {
    const [, end] = morphFrames(
      { ...box, x: 0, y: 0, w: 100, h: 50, rotation: 0 },
      { x: 0, y: 0, w: 100, h: 50, rotation: 0, flipH: true, flipV: false },
      1
    );
    expect(end).toContain('scale(-1, 1)');
  });

  it('keeps text-only boxes at their size', () => {
    const words = [{ text: 'Revenue', level: 0 }];
    expect(textOnly({ kind: 'shape', paragraphs: words })).toBe(true);
    expect(
      textOnly({ kind: 'shape', fill: '#FF0000', paragraphs: words })
    ).toBe(false);
    expect(textOnly({ kind: 'shape', paragraphs: [] })).toBe(false);
    const [, end] = morphFrames(
      { ...box, x: 0, y: 0, w: 100, h: 50, rotation: 0 },
      { ...box, x: 0, y: 0, w: 300, h: 80, rotation: 0 },
      1,
      true
    );
    expect(end).toContain('scale(1, 1)');
  });
});

describe('text units', () => {
  /** One paragraph per line, 10 points per character, 20-point lines. */
  function layout(lines: string[], dx = 100, dy = 50): TextLayoutInfo {
    return {
      transform: [1, 0, 0, 1, dx, dy],
      size: [400, 200],
      paragraphs: lines,
      styles: [],
      lines: lines.map((text, paragraph) => ({
        paragraph,
        top: paragraph * 20,
        baseline: paragraph * 20 + 16,
        bottom: paragraph * 20 + 20,
        stops: [...text, ''].map((_, index) => ({ index, x: index * 10 })),
      })),
    };
  }

  it('splits laid-out text into words or letters with their boxes', () => {
    const words = textUnits(layout(['Hello  big', 'world']), 'word');
    expect(words).toEqual([
      { text: 'Hello', rect: { x: 100, y: 50, w: 50, h: 20 } },
      { text: 'big', rect: { x: 170, y: 50, w: 30, h: 20 } },
      { text: 'world', rect: { x: 100, y: 70, w: 50, h: 20 } },
    ]);
    const letters = textUnits(layout(['a b']), 'char');
    expect(letters.map((u) => [u.text, u.rect.x])).toEqual([
      ['a', 100],
      ['b', 120],
    ]);
  });

  it('pairs equal words in reading order', () => {
    const a = textUnits(layout(['the cat and the dog']), 'word');
    const b = textUnits(layout(['the dog and a cat the']), 'word');
    expect(matchUnits(a, b)).toEqual({
      // the, dog, and, cat, the (second); "a" is new.
      pairs: [
        [0, 0],
        [4, 1],
        [2, 2],
        [1, 4],
        [3, 5],
      ],
      leaving: [],
      entering: [3],
    });
  });
});

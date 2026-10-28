import type { GuideOutline } from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import {
  addGuide,
  dragPosition,
  GUIDE_STEP,
  guideAt,
  guideLabel,
  guideLines,
  moveGuide,
  newGuidePosition,
  recolorGuide,
  removeGuide,
} from './guides';
import { snapMove } from './snap';

const SLIDE = { w: 960, h: 540 };

const GUIDES: GuideOutline[] = [
  { id: 1, orient: 'horizontal', position: 270, color: 'A4A3A4' },
  { id: 2, orient: 'vertical', position: 480 },
  { id: 5, orient: 'vertical', position: 120, color: 'accent2' },
];

describe('snapping to drawing guides', () => {
  const lines = guideLines(GUIDES);

  it('collects vertical guides as x lines and horizontal ones as y lines', () => {
    expect(lines).toEqual({ xs: [480, 120], ys: [270] });
  });

  it('snaps a shape edge to a guide within the threshold', () => {
    const snap = snapMove({ x: 123, y: 400, w: 50, h: 30 }, [], SLIDE, 4, {
      guides: false,
      drawingGuides: lines,
    });
    expect(snap.dx).toBe(-3);
    expect(snap.dy).toBe(0);
  });

  it('snaps the center and the far edge too', () => {
    // Center 270 + 2 lands on the horizontal guide; right edge 478 on 480.
    const snap = snapMove({ x: 428, y: 252, w: 50, h: 40 }, [], SLIDE, 4, {
      guides: false,
      drawingGuides: lines,
    });
    expect(snap.dx).toBe(2);
    expect(snap.dy).toBe(-2);
  });

  it('does not report drawing guides as smart guides', () => {
    const snap = snapMove({ x: 123, y: 400, w: 50, h: 30 }, [], SLIDE, 4, {
      drawingGuides: lines,
    });
    expect(snap.dx).toBe(-3);
    expect(snap.guides.xs).toEqual([]);
  });

  it('prefers the closest line among guides and smart guides', () => {
    const other = { x: 125, y: 0, w: 10, h: 10 };
    const snap = snapMove({ x: 124, y: 400, w: 50, h: 30 }, [other], SLIDE, 4, {
      drawingGuides: lines,
    });
    expect(snap.dx).toBe(1);
    expect(snap.guides.xs).toEqual([125]);
  });

  it('falls back to the grid away from guides', () => {
    const snap = snapMove({ x: 301, y: 401, w: 10, h: 10 }, [], SLIDE, 4, {
      guides: false,
      grid: 6,
      drawingGuides: lines,
    });
    expect(snap).toMatchObject({ dx: -1, dy: 1 });
  });

  it('ignores guides when none are shown', () => {
    const snap = snapMove({ x: 123, y: 400, w: 50, h: 30 }, [], SLIDE, 4, {
      guides: false,
    });
    expect(snap.dx).toBe(0);
  });
});

describe('guide hit testing', () => {
  it('finds the nearest guide within the tolerance', () => {
    expect(guideAt(GUIDES, { x: 482, y: 10 }, 3)).toBe(1);
    expect(guideAt(GUIDES, { x: 10, y: 268 }, 3)).toBe(0);
    expect(guideAt(GUIDES, { x: 300, y: 100 }, 3)).toBeUndefined();
  });

  it('picks the closer of two crossing guides', () => {
    expect(guideAt(GUIDES, { x: 481, y: 272 }, 3)).toBe(1);
    expect(guideAt(GUIDES, { x: 483, y: 271 }, 3)).toBe(0);
  });
});

describe('dragging a guide', () => {
  it('follows the pointer across the guide in steps from the center', () => {
    expect(
      dragPosition('vertical', { x: 487, y: 5 }, SLIDE, GUIDE_STEP)
    ).toEqual({ position: 486, off: false });
    expect(
      dragPosition('horizontal', { x: 5, y: 100.4 }, SLIDE, GUIDE_STEP)
    ).toEqual({ position: 99, off: false });
  });

  it('moves freely without steps', () => {
    expect(dragPosition('vertical', { x: 487.3, y: 5 }, SLIDE, 0)).toEqual({
      position: 487.3,
      off: false,
    });
  });

  it('notices the pointer leaving the slide', () => {
    expect(
      dragPosition('vertical', { x: -4, y: 5 }, SLIDE, GUIDE_STEP)
    ).toEqual({ position: 0, off: true });
    expect(
      dragPosition('horizontal', { x: 5, y: 560 }, SLIDE, GUIDE_STEP)
    ).toEqual({ position: 540, off: true });
  });

  it('moves a guide keeping its id and color', () => {
    expect(moveGuide(GUIDES, 2, 150, false)).toEqual([
      { orient: 'horizontal', position: 270, color: 'A4A3A4', id: 1 },
      { orient: 'vertical', position: 480, id: 2 },
      { orient: 'vertical', position: 150, color: 'accent2', id: 5 },
    ]);
  });

  it('copies a guide (Ctrl+drag) as a new one in the same color', () => {
    const list = moveGuide(GUIDES, 2, 150, true);
    expect(list).toHaveLength(4);
    expect(list[2]).toMatchObject({ position: 120, id: 5 });
    expect(list[3]).toEqual({
      orient: 'vertical',
      position: 150,
      color: 'accent2',
    });
  });

  it('removes and recolors guides', () => {
    expect(removeGuide(GUIDES, 0).map((g) => g.id)).toEqual([2, 5]);
    expect(recolorGuide(GUIDES, 1, 'FF0000')[1]).toEqual({
      orient: 'vertical',
      position: 480,
      color: 'FF0000',
      id: 2,
    });
  });
});

describe('the guide tooltip', () => {
  it('measures from the center in inches, pointing away from it', () => {
    expect(guideLabel('vertical', 480, SLIDE)).toBe('0.00');
    expect(guideLabel('vertical', 300, SLIDE)).toBe('← 2.50');
    expect(guideLabel('vertical', 534, SLIDE)).toBe('0.75 →');
    expect(guideLabel('horizontal', 180, SLIDE)).toBe('↑ 1.25');
    expect(guideLabel('horizontal', 540, SLIDE)).toBe('3.75 ↓');
  });
});

describe('adding guides', () => {
  it('starts at the center, then half an inch to either side', () => {
    expect(newGuidePosition([], 'vertical', SLIDE)).toBe(480);
    expect(newGuidePosition(GUIDES, 'vertical', SLIDE)).toBe(516);
    expect(newGuidePosition(GUIDES, 'horizontal', SLIDE)).toBe(306);
    const taken: GuideOutline[] = [
      { id: 1, orient: 'vertical', position: 480 },
      { id: 2, orient: 'vertical', position: 516 },
    ];
    expect(newGuidePosition(taken, 'vertical', SLIDE)).toBe(444);
  });

  it('appends the new guide to the list', () => {
    const list = addGuide(GUIDES, 'horizontal', SLIDE);
    expect(list).toHaveLength(4);
    expect(list[3]).toEqual({ orient: 'horizontal', position: 306 });
  });
});

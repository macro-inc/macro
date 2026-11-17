import { expect, it } from 'vitest';
import {
  rotationKnobOffset,
  rotationKnobPoint,
  touchHandleAt,
} from '../src/core/selection-handles';

// A 200 x 100 frame on screen, corners in nw, ne, se, sw order.
const frame = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 200 },
  { x: 100, y: 200 },
];
const knob = rotationKnobPoint(frame, true, rotationKnobOffset(true));

it('stands the rotation knob off the top edge, on the outside', () => {
  expect(rotationKnobPoint(frame, true, rotationKnobOffset(false))).toEqual({
    x: 200,
    y: 84,
  });
  // A frame flipped by a resize still carries the knob outside it.
  const flipped = [frame[3]!, frame[2]!, frame[1]!, frame[0]!];
  expect(rotationKnobPoint(flipped, true, rotationKnobOffset(false))).toEqual({
    x: 200,
    y: 216,
  });
});

it('gives a finger the corner from 12px away in any direction', () => {
  expect(touchHandleAt(frame, knob, { x: 88, y: 100 })).toBe('nw');
  expect(touchHandleAt(frame, knob, { x: 309, y: 208 })).toBe('se');
  expect(touchHandleAt(frame, knob, { x: 108, y: 109 })).toBe('nw');
});

it('gives a finger the rotation knob from 12px away', () => {
  expect(touchHandleAt(frame, knob, { x: 200, y: 56 })).toBe('rotate');
  expect(touchHandleAt(frame, knob, { x: 210, y: 74 })).toBe('rotate');
});

it('gives a finger an edge from just outside it, and less from inside', () => {
  expect(touchHandleAt(frame, knob, { x: 200, y: 210 })).toBe('s');
  expect(touchHandleAt(frame, knob, { x: 311, y: 150 })).toBe('e');
  expect(touchHandleAt(frame, knob, { x: 200, y: 194 })).toBe('s');
  expect(touchHandleAt(frame, knob, { x: 200, y: 188 })).toBeUndefined();
});

it('leaves the middle of the frame, and anything far from it, to a move', () => {
  expect(touchHandleAt(frame, knob, { x: 200, y: 150 })).toBeUndefined();
  expect(touchHandleAt(frame, knob, { x: 60, y: 60 })).toBeUndefined();
});

it('keeps the middle of a small shape for moving it', () => {
  // 40 x 40 on screen: a finger at its centre must not resize it.
  const small = [
    { x: 100, y: 100 },
    { x: 140, y: 100 },
    { x: 140, y: 140 },
    { x: 100, y: 140 },
  ];
  expect(touchHandleAt(small, undefined, { x: 120, y: 120 })).toBeUndefined();
  expect(touchHandleAt(small, undefined, { x: 112, y: 120 })).toBeUndefined();
  // Just outside a corner still resizes.
  expect(touchHandleAt(small, undefined, { x: 148, y: 148 })).toBe('se');
});

it('keeps the middle of a short side for its edge, not a corner', () => {
  // One line of text, 200 x 20 on screen: both left corners are within reach
  // of a finger beside its left side, which means the side.
  const line = [
    { x: 100, y: 100 },
    { x: 300, y: 100 },
    { x: 300, y: 120 },
    { x: 100, y: 120 },
  ];
  expect(touchHandleAt(line, undefined, { x: 92, y: 110 })).toBe('w');
  expect(touchHandleAt(line, undefined, { x: 308, y: 110 })).toBe('e');
  // The corners keep the ends of the side and everything diagonal to them.
  expect(touchHandleAt(line, undefined, { x: 92, y: 103 })).toBe('nw');
  expect(touchHandleAt(line, undefined, { x: 92, y: 126 })).toBe('sw');
});

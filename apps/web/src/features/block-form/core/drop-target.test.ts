import { describe, expect, it } from 'vitest';
import {
  lineForPlacement,
  lineForSectionIndex,
  type MeasuredSection,
  placementOf,
  questionDropAt,
  samePlacement,
  sectionDropAt,
  stepPlacement,
} from './drop-target';
import type { FormLayout } from './form-model';

const box = (top: number, bottom: number) => ({
  top,
  bottom,
  left: 0,
  right: 600,
});

/**
 * About (0–300): q1 40–100, q2 110–170, q3 180–240
 * Gate (320–420)
 * Details (440–600): empty list 480–560
 */
const measured: MeasuredSection[] = [
  {
    id: 'about',
    kind: 'questions',
    box: box(0, 300),
    list: box(30, 250),
    questions: [
      { id: 'q1', box: box(40, 100) },
      { id: 'q2', box: box(110, 170) },
      { id: 'q3', box: box(180, 240) },
    ],
  },
  {
    id: 'gate',
    kind: 'gate',
    box: box(320, 420),
    list: box(320, 420),
    questions: [],
  },
  {
    id: 'details',
    kind: 'questions',
    box: box(440, 600),
    list: box(480, 560),
    questions: [],
  },
];

describe('questionDropAt', () => {
  it('lands q1 dragged to between q2 and q3 at index 1 of the others, the line midway', () => {
    expect(questionDropAt(172, measured, 'q1')).toEqual({
      sectionId: 'about',
      index: 1,
      lineY: 175,
    });
  });

  it('lands above the first and below the last question', () => {
    expect(questionDropAt(10, measured, 'q2')).toEqual({
      sectionId: 'about',
      index: 0,
      lineY: 36,
    });
    expect(questionDropAt(280, measured, 'q1')).toEqual({
      sectionId: 'about',
      index: 2,
      lineY: 244,
    });
  });

  it('drops into an empty section at the middle of its list', () => {
    expect(questionDropAt(500, measured, 'q1')).toEqual({
      sectionId: 'details',
      index: 0,
      lineY: 520,
    });
  });

  it('sends a pointer over a gate to the nearest questions section', () => {
    expect(questionDropAt(330, measured, 'q1')?.sectionId).toBe('about');
    expect(questionDropAt(415, measured, 'q1')?.sectionId).toBe('details');
    expect(questionDropAt(2000, measured, 'q1')?.sectionId).toBe('details');
  });
});

describe('sectionDropAt', () => {
  it('lands between the sections whose middles straddle the pointer', () => {
    const sections = measured.map(({ id, box: sectionBox }) => ({
      id,
      box: sectionBox,
    }));
    expect(sectionDropAt(-10, sections, 'details')).toEqual({
      index: 0,
      lineY: -4,
    });
    expect(sectionDropAt(380, sections, 'about')).toEqual({
      index: 1,
      lineY: 430,
    });
    expect(
      sectionDropAt(10, [{ id: 'only', box: box(0, 10) }], 'only')
    ).toBeUndefined();
  });
});

const layout: FormLayout = {
  sections: [
    {
      id: 'about',
      title: '',
      description: '',
      kind: 'questions',
      gateRules: null,
      gateMessage: '',
      bookingTarget: null,
      questions: ['q1', 'q2'].map((id) => ({
        id,
        columnId: `column-${id}`,
        helpText: '',
        required: false,
        widget: null,
      })),
    },
    {
      id: 'gate',
      title: '',
      description: '',
      kind: 'gate',
      gateRules: null,
      gateMessage: '',
      bookingTarget: null,
      questions: [],
    },
    {
      id: 'details',
      title: '',
      description: '',
      kind: 'questions',
      gateRules: null,
      gateMessage: '',
      bookingTarget: null,
      questions: [
        {
          id: 'q3',
          columnId: 'column-q3',
          helpText: '',
          required: false,
          widget: null,
        },
      ],
    },
  ],
};

describe('stepPlacement', () => {
  it('moves a question one slot at a time, over the gate into the next section and back', () => {
    const start = placementOf(layout, 'q2');
    expect(start).toEqual({ sectionId: 'about', index: 1 });
    const down = stepPlacement(layout, 'q2', start!, 'down');
    expect(down).toEqual({ sectionId: 'details', index: 0 });
    const further = stepPlacement(layout, 'q2', down!, 'down');
    expect(further).toEqual({ sectionId: 'details', index: 1 });
    expect(stepPlacement(layout, 'q2', further!, 'down')).toBeUndefined();
    expect(stepPlacement(layout, 'q2', down!, 'up')).toEqual({
      sectionId: 'about',
      index: 1,
    });
    expect(
      stepPlacement(layout, 'q1', { sectionId: 'about', index: 0 }, 'up')
    ).toBeUndefined();
    expect(
      stepPlacement(layout, 'q1', { sectionId: 'about', index: 0 }, 'down')
    ).toEqual({ sectionId: 'about', index: 1 });
  });

  it('compares placements', () => {
    expect(
      samePlacement({ sectionId: 'a', index: 1 }, { sectionId: 'a', index: 1 })
    ).toBe(true);
    expect(samePlacement({ sectionId: 'a', index: 1 }, undefined)).toBe(false);
  });
});

describe('lines for keyboard placements', () => {
  it('draws the line where a pointer drop at the same placement would', () => {
    expect(
      lineForPlacement(measured, 'q1', { sectionId: 'about', index: 1 })
    ).toBe(175);
    expect(
      lineForPlacement(measured, 'q1', { sectionId: 'details', index: 0 })
    ).toBe(520);
    expect(
      lineForSectionIndex(
        measured.map(({ id, box: sectionBox }) => ({ id, box: sectionBox })),
        'gate',
        1
      )
    ).toBe(370);
  });
});

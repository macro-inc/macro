import type { TextLayoutInfo } from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_EQUATIONS,
  equationAt,
  equationOfSelection,
  equationSelection,
  insertedEquation,
  insertTemplate,
  newEquation,
  OBJECT_CHAR,
  STRUCTURES,
  SYMBOL_GROUPS,
  sameEquation,
  selectedEquation,
  symbolId,
  symbolText,
  type TextEditing,
} from './equations';

/**
 * "a=￼+1" with an inline equation at index 2, then a paragraph holding a
 * display equation, then an empty paragraph. Shape at (100, 200).
 */
const layout: TextLayoutInfo = {
  transform: [1, 0, 0, 1, 100, 200],
  size: [300, 120],
  paragraphs: [`a=${OBJECT_CHAR}+1`, OBJECT_CHAR, ''],
  lines: [
    {
      paragraph: 0,
      top: 0,
      baseline: 14,
      bottom: 20,
      stops: [
        { index: 0, x: 0 },
        { index: 1, x: 10 },
        { index: 2, x: 20 },
        { index: 3, x: 60 },
        { index: 4, x: 70 },
        { index: 5, x: 80 },
      ],
    },
    {
      paragraph: 1,
      top: 20,
      baseline: 50,
      bottom: 70,
      stops: [
        { index: 0, x: 100 },
        { index: 1, x: 200 },
      ],
    },
    {
      paragraph: 2,
      top: 70,
      baseline: 84,
      bottom: 90,
      stops: [{ index: 0, x: 0 }],
    },
  ],
  styles: [],
  equations: [
    {
      paragraph: 0,
      index: 2,
      x: 20,
      y: 0,
      w: 40,
      h: 20,
      latex: '\\frac{1}{2}',
      display: false,
    },
    {
      paragraph: 1,
      index: 0,
      x: 100,
      y: 20,
      w: 100,
      h: 50,
      latex: '\\sum_{i=1}^n i',
      display: true,
    },
  ],
};

const editing = (
  anchor: [number, number],
  focus: [number, number] = anchor
): TextEditing => ({
  shape: 7,
  layout,
  selection: {
    anchor: { paragraph: anchor[0], offset: anchor[1] },
    focus: { paragraph: focus[0], offset: focus[1] },
  },
});

describe('linear text templates', () => {
  it('puts the caret in the first empty slot', () => {
    expect(insertTemplate('x=', 2, 2, '\\frac{}{}')).toEqual({
      text: 'x=\\frac{}{}',
      caret: 8,
    });
  });

  it('wraps the selected text in the first slot, caret in the next', () => {
    expect(insertTemplate('a+b', 0, 3, '\\frac{}{}')).toEqual({
      text: '\\frac{a+b}{}',
      caret: 11,
    });
    // A backwards selection works the same way.
    expect(insertTemplate('a+b', 3, 0, '\\sqrt{}')).toEqual({
      text: '\\sqrt{a+b}',
      caret: 10,
    });
  });

  it('puts the caret after a template without slots', () => {
    expect(insertTemplate('x', 1, 1, '\\pm ')).toEqual({
      text: 'x\\pm ',
      caret: 5,
    });
  });
});

describe('symbols', () => {
  it('inserts commands with a separating space, characters as they are', () => {
    expect(symbolText({ char: '±', command: 'pm' })).toBe('\\pm ');
    expect(symbolText({ char: '=' })).toBe('=');
    expect(symbolId({ char: '±', command: 'pm' })).toBe('pm');
    expect(symbolId({ char: '=' })).toBe('u003d');
  });

  it('gives every symbol a distinct test id', () => {
    const ids = SYMBOL_GROUPS.flatMap((g) => g.symbols.map(symbolId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has the galleries PowerPoint has', () => {
    expect(STRUCTURES.map((s) => s.id)).toEqual([
      'fraction',
      'script',
      'radical',
      'integral',
      'large-operator',
      'bracket',
      'function',
      'accent',
      'limit-and-log',
      'operator',
      'matrix',
    ]);
    expect(BUILT_IN_EQUATIONS.map((e) => e.name)).toEqual([
      'Area of Circle',
      'Binomial Theorem',
      'Expansion of a Sum',
      'Fourier Series',
      'Pythagorean Theorem',
      'Quadratic Formula',
      'Taylor Expansion',
      'Trig Identity 1',
      'Trig Identity 2',
    ]);
  });
});

describe('equations in laid-out text', () => {
  it('finds the equation under a slide point', () => {
    expect(equationAt(layout, { x: 130, y: 210 })?.index).toBe(2);
    expect(equationAt(layout, { x: 250, y: 240 })?.paragraph).toBe(1);
    expect(equationAt(layout, { x: 105, y: 210 })).toBeUndefined();
  });

  it('knows a selection covering exactly one equation', () => {
    const at = (p: number, o: number) => ({ paragraph: p, offset: o });
    expect(selectedEquation(layout, at(0, 2), at(0, 3))?.latex).toBe(
      '\\frac{1}{2}'
    );
    expect(selectedEquation(layout, at(0, 3), at(0, 2))?.index).toBe(2);
    expect(selectedEquation(layout, at(0, 1), at(0, 3))).toBeUndefined();
    expect(selectedEquation(layout, at(0, 3), at(0, 4))).toBeUndefined();
    expect(equationSelection({ paragraph: 1, index: 0 })).toEqual({
      anchor: at(1, 0),
      focus: at(1, 1),
    });
  });

  it('describes the selected equation for the editor', () => {
    expect(equationOfSelection(256, editing([1, 0], [1, 1]))).toEqual({
      slide: 256,
      shape: 7,
      paragraph: 1,
      index: 0,
      latex: '\\sum_{i=1}^n i',
      display: true,
    });
    expect(equationOfSelection(256, editing([0, 2]))).toBeUndefined();
    expect(equationOfSelection(256, null)).toBeUndefined();
    const a = equationOfSelection(256, editing([0, 2], [0, 3]));
    expect(
      sameEquation(a, equationOfSelection(256, editing([0, 3], [0, 2])))
    ).toBe(true);
    expect(sameEquation(a, undefined)).toBe(false);
  });

  it('finds the equation just inserted', () => {
    expect(insertedEquation(layout, { paragraph: 0, offset: 2 })?.index).toBe(
      2
    );
    // A display equation splits the paragraph: it is the next one found.
    expect(
      insertedEquation(layout, { paragraph: 0, offset: 4 })?.paragraph
    ).toBe(1);
    expect(insertedEquation(layout, { paragraph: 2, offset: 0 })).toBe(
      undefined
    );
  });
});

describe('where a new equation goes', () => {
  it('goes into a new display text box when no text is edited', () => {
    expect(newEquation(256, null, '')).toEqual({
      where: { kind: 'box', slide: 256 },
      text: '',
      display: true,
    });
  });

  it('goes inline at the caret of text', () => {
    expect(newEquation(256, editing([0, 1]), '')).toEqual({
      where: {
        kind: 'text',
        slide: 256,
        shape: 7,
        at: { paragraph: 0, offset: 1 },
      },
      text: '',
      display: false,
    });
  });

  it('is a display equation in an empty paragraph', () => {
    expect(newEquation(256, editing([2, 0]), '').display).toBe(true);
  });

  it('turns selected text into its linear text', () => {
    expect(newEquation(256, editing([0, 5], [0, 0]), 'a=x+1')).toEqual({
      where: {
        kind: 'text',
        slide: 256,
        shape: 7,
        at: { paragraph: 0, offset: 0 },
        end: { paragraph: 0, offset: 5 },
      },
      text: 'a=x+1',
      display: false,
    });
    // Text across paragraphs, or holding an equation, is not converted.
    const across = newEquation(
      256,
      editing([0, 0], [1, 1]),
      `a\n${OBJECT_CHAR}`
    );
    expect(across.text).toBe('');
    expect(across.where.kind === 'text' && across.where.end).toBeFalsy();
  });
});

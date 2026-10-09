import { describe, expect, it } from 'vitest';
import {
  FORMULA_REFERENCE_COLORS,
  formulaRangeReference,
  formulaReferenceSlot,
  formulaReferences,
} from './formula-reference';
import { SPREADSHEET_MAX_ROWS } from './spreadsheet-document';

describe('formula reference slots', () => {
  it.each(['=', '=SUM(', '=A1+', '=IF(A1>0, ', '=SUM(B1:B4,'])(
    'inserts an operand at the end of %s',
    (text) => {
      expect(
        formulaReferenceSlot(text, { start: text.length, end: text.length })
      ).toEqual({ start: text.length, end: text.length });
    }
  );

  it('replaces an existing mixed reference/range, preserving surrounding formula text', () => {
    expect(
      formulaReferenceSlot('=SUM($B4:C$8)+1', { start: 9, end: 9 })
    ).toEqual({ start: 5, end: 12 });
    expect(
      formulaReferenceSlot('=SUM(B4:B8)+1', { start: 5, end: 10 })
    ).toEqual({ start: 5, end: 10 });
    expect(
      formulaReferenceSlot('=SUM(B4:B8,)', { start: 10, end: 10 })
    ).toEqual({ start: 5, end: 10 });
  });

  it.each([
    'plain text',
    '=SUM(A1)',
    '=123',
    '=SUM("hello ',
    '=SUM("a""b',
    "='Sheet 1",
    '=SUM',
    '=LOG10(',
  ])(
    'does not mistake literals or completed expressions for a reference slot: %s',
    (text) => {
      // A function's argument is valid, but its name must not become a reference.
      const cursor = text === '=LOG10(' ? 4 : text.length;
      expect(
        formulaReferenceSlot(text, { start: cursor, end: cursor })
      ).toBeUndefined();
    }
  );

  it('keeps a closing parenthesis and later arguments when inserting mid-formula', () => {
    expect(formulaReferenceSlot('=SUM(,B1)', { start: 5, end: 5 })).toEqual({
      start: 5,
      end: 5,
    });
  });

  it('normalizes reverse drags and keeps a single-cell reference concise', () => {
    expect(
      formulaRangeReference({
        anchor: { row: 7, column: 3 },
        focus: { row: 3, column: 1 },
      })
    ).toBe('B4:D8');
    expect(
      formulaRangeReference({
        anchor: { row: 3, column: 1 },
        focus: { row: 3, column: 1 },
      })
    ).toBe('B4');
  });
});

it('quotes cross-sheet ranges and replaces a complete sheet-qualified operand', () => {
  const range = { anchor: { row: 0, column: 0 }, focus: { row: 3, column: 1 } };
  expect(formulaRangeReference(range, "Owner's budget")).toBe(
    "'Owner''s budget'!A1:B4"
  );
  for (const reference of ["'Owner''s budget'!A1:B4", 'Sheet2!$C$3:$D8']) {
    const text = `=SUM(${reference},2)`;
    expect(
      formulaReferenceSlot(text, {
        start: 5 + reference.length,
        end: 5 + reference.length,
      })
    ).toEqual({ start: 5, end: 5 + reference.length });
  }
  expect(formulaReferenceSlot("='Cash flow'!A1", { start: 6, end: 6 })).toEqual(
    { start: 1, end: 15 }
  );
  expect(
    formulaReferenceSlot('="Sheet2!A1"', { start: 8, end: 8 })
  ).toBeUndefined();
});

describe('formula references', () => {
  const spans = (text: string) =>
    formulaReferences(text).map((reference) =>
      text.slice(reference.start, reference.end)
    );

  it('finds cells, ranges, and whole rows or columns with their bounds', () => {
    const text = '=SUM($B4:c$8)+A1*COUNT(D:D)+SUM(2:3)';
    expect(spans(text)).toEqual(['$B4:c$8', 'A1', 'D:D', '2:3']);
    expect(formulaReferences(text).map((value) => value.bounds)).toEqual([
      { top: 3, bottom: 7, left: 1, right: 2 },
      { top: 0, bottom: 0, left: 0, right: 0 },
      { top: 0, bottom: SPREADSHEET_MAX_ROWS - 1, left: 3, right: 3 },
      expect.objectContaining({ top: 1, bottom: 2, left: 0 }),
    ]);
  });

  it('colors each distinct reference in order and reuses a repeated one', () => {
    const colors = formulaReferences('=A1+B2+$A$1+C3').map(
      (value) => value.color
    );
    expect(colors).toEqual([
      FORMULA_REFERENCE_COLORS[0],
      FORMULA_REFERENCE_COLORS[1],
      FORMULA_REFERENCE_COLORS[0],
      FORMULA_REFERENCE_COLORS[2],
    ]);
  });

  it('reads sheet names, quoted or not', () => {
    const references = formulaReferences(
      "='Owner''s budget'!A1:B4+Sheet2!C3+C3"
    );
    expect(references.map((value) => value.sheetName)).toEqual([
      "Owner's budget",
      'Sheet2',
      undefined,
    ]);
    expect(references[1].color).not.toBe(references[2].color);
  });

  it.each([
    'A1',
    '="A1"&B2',
    '=LOG10(2)',
    '=ATAN2(1,2)',
    "='My A1 sheet'!",
    '=A1A',
    '=XFE1',
  ])('ignores text that only looks like a reference: %s', (text) => {
    expect(spans(text).filter((span) => span !== 'B2')).toEqual([]);
  });

  it('keeps references outside strings that contain apostrophes', () => {
    expect(spans(`="it's"&A2`)).toEqual(['A2']);
  });
});

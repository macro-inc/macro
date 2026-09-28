import { describe, expect, it } from 'vitest';
import {
  formulaRangeReference,
  formulaReferenceSlot,
} from './formula-reference';

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

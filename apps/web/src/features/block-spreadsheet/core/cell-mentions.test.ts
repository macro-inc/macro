import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync } from '@ironcalc/wasm';
import { AutomergeDoc } from '@macro-inc/automerge';
import { createInitializedSpreadsheetCalculator } from '@macro-inc/spreadsheet/calculation';
import {
  cellDateMention,
  cellMentionQuery,
  cellPlainText,
  cellTextParts,
  encodeCellMention,
} from '@macro-inc/spreadsheet/cell-mentions';
import { beforeAll, describe, expect, it } from 'vitest';
import { encodeCsv } from './csv-export';
import {
  readSpreadsheetCells,
  writeSpreadsheetCells,
} from './spreadsheet-document';

beforeAll(() =>
  initSync({
    module: readFileSync(
      createRequire(import.meta.url).resolve('@ironcalc/wasm/wasm_bg.wasm')
    ),
  })
);
const person = encodeCellMention({
  type: 'user',
  userId: 'macro|test@macro.com',
  email: 'test@macro.com',
  displayName: 'Taylor',
});
describe('spreadsheet mention source', () => {
  it('reuses docs tags with mixed text while treating all other Markdown literally', () => {
    expect(cellPlainText(`**Owner:** ${person} _review_`)).toBe(
      '**Owner:** @Taylor _review_'
    );
    expect(cellTextParts(`Hi ${person}!`)).toHaveLength(3);
    expect(
      cellPlainText('=CONCAT("' + person + '")').startsWith('=CONCAT')
    ).toBe(true);
  });
  it('preserves malformed or unsafe mention payloads as text', () => {
    for (const text of [
      '<m-user-mention>bad</m-user-mention>',
      '<m-document-mention>{"documentId":"id","documentName":"X","blockName":"javascript"}</m-document-mention>',
    ])
      expect(cellPlainText(text)).toBe(text);
    const mention = encodeCellMention({
      type: 'document',
      documentId: 'a',
      documentName: '</m-document-mention><img src=x>',
      blockName: 'md',
    });
    expect(cellTextParts(mention)[0].mention?.type).toBe('document');
    expect(mention).not.toContain('<img');
  });
  it('finds @ queries at the caret without matching email addresses, formula strings, or encoded pills', () => {
    expect(cellMentionQuery('Owner @tay', 10)).toEqual({
      start: 6,
      end: 10,
      query: 'tay',
    });
    expect(cellMentionQuery('test@macro.com', 14)).toBeUndefined();
    expect(cellMentionQuery('="@tay"', 6)).toBeUndefined();
    expect(cellMentionQuery(person, 20)).toBeUndefined();
    expect(cellMentionQuery(person + ' @', person.length + 2)?.query).toBe('');
  });
  it('round trips through collaboration and calculates/export labels without stripping stored mentions', () => {
    const first = new AutomergeDoc(),
      second = new AutomergeDoc();
    const engine = createInitializedSpreadsheetCalculator();
    try {
      writeSpreadsheetCells(first, {
        A1: { value: person },
        B1: { value: '=A1&" owns this"' },
        C1: {
          value: encodeCellMention({
            type: 'document',
            documentId: 'doc',
            documentName: '=1+1',
            blockName: 'md',
          }),
        },
      });
      second.import(first.export({ mode: 'snapshot' }));
      const cells = readSpreadsheetCells(second);
      const values = engine.calculate(cells);
      expect(cells.A1.value).toBe(person);
      expect(values.A1.display).toBe('@Taylor');
      expect(values.B1.display).toBe('@Taylor owns this');
      expect(values.C1.display).toBe('=1+1');
      expect(values.C1.number).toBeUndefined();
      expect(encodeCsv(cells, values)).not.toContain('m-user');
    } finally {
      first.free();
      second.free();
      engine.dispose();
    }
  });
  it('reads the docs date mention encoding and rejects unparseable dates', () => {
    const due = encodeCellMention({
      type: 'date',
      date: '2026-09-28T04:00:00.000Z',
      displayFormat: 'Tomorrow',
    });
    expect(cellTextParts(due)[0].mention).toEqual({
      type: 'date',
      date: '2026-09-28T04:00:00.000Z',
      displayFormat: 'Tomorrow',
    });
    expect(cellPlainText(`Due ${due}!`)).toBe('Due Tomorrow!');
    expect(
      cellPlainText(
        '<m-date-mention>{"date":"2026-09-28T04:00:00.000Z","displayFormat":"","mentionUuid":"m1"}</m-date-mention>'
      )
    ).toBe('Sep 28, 2026');
    for (const text of [
      '<m-date-mention>{"date":"someday","displayFormat":"Someday"}</m-date-mention>',
      '<m-date-mention>{"displayFormat":"Tomorrow"}</m-date-mention>',
    ])
      expect(cellPlainText(text)).toBe(text);
    expect(cellMentionQuery(`${due} @tom`, due.length + 5)?.query).toBe('tom');
  });
  it('identifies cells holding a single date pill', () => {
    const due = encodeCellMention({
      type: 'date',
      date: '2026-09-28T04:00:00.000Z',
      displayFormat: 'Tomorrow',
    });
    expect(cellDateMention(due)?.date).toBe('2026-09-28T04:00:00.000Z');
    expect(cellDateMention(`  ${due} \n`)?.displayFormat).toBe('Tomorrow');
    expect(cellDateMention(`Due ${due}`)).toBeUndefined();
    expect(cellDateMention(`${due}${due}`)).toBeUndefined();
    expect(cellDateMention(`${person} ${due}`)).toBeUndefined();
    expect(cellDateMention('9/28/2026')).toBeUndefined();
  });
  it('calculates a lone date pill as that calendar date in the local time zone', () => {
    const engine = createInitializedSpreadsheetCalculator();
    try {
      const local = new Date(2026, 8, 28, 9, 30);
      const due = encodeCellMention({
        type: 'date',
        date: local.toISOString(),
        displayFormat: 'Tomorrow',
      });
      const values = engine.calculate({
        A1: { value: `${due} ` },
        A2: { value: '=A1+7' },
        A3: { value: `Due ${due}` },
        A4: { value: '=A3' },
        A5: { value: due, format: 'number' },
        A6: { value: due, format: 'text' },
        A7: { value: '=A1-DATE(2026,9,20)' },
      });
      // The pill's time of day is dropped so date arithmetic stays whole days.
      expect(values.A1).toEqual({ display: '9/28/2026', number: 46293 });
      expect(values.A2).toEqual({ display: '10/5/2026', number: 46300 });
      expect(values.A3).toEqual({ display: 'Due Tomorrow' });
      expect(values.A4).toEqual({ display: 'Due Tomorrow' });
      expect(values.A5).toEqual({ display: '46,293.00', number: 46293 });
      expect(values.A6).toEqual({ display: 'Tomorrow' });
      // A day count is not a date, even though the engine formats it as one.
      expect(values.A7).toEqual({ display: '8', number: 8 });
    } finally {
      engine.dispose();
    }
  });
});

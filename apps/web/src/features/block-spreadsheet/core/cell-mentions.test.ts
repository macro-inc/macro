import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync } from '@ironcalc/wasm';
import { createInitializedSpreadsheetCalculator } from '@macro-inc/spreadsheet/calculation';
import {
  cellMentionQuery,
  cellPlainText,
  cellTextParts,
  encodeCellMention,
} from '@macro-inc/spreadsheet/cell-mentions';
import { LoroDoc } from 'loro-crdt';
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
    const first = new LoroDoc(),
      second = new LoroDoc();
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
});

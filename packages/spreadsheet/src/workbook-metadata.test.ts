import { describe, expect, it } from 'vitest';
import { parseWorkbookMetadata } from './workbook-metadata';

describe('workbook metadata', () => {
  const pivot = {
    table: '<pivotTableDefinition name="Sales"/>',
    cache: '<pivotCacheDefinition/>',
    location: 'A3:D11',
  };
  const parse = (pivotTables: unknown[]) =>
    parseWorkbookMetadata(JSON.stringify({ pivotTables }));

  it('keeps what a pivot table over another workbook or a connection saved', () => {
    const cached = {
      ...pivot,
      records: '<pivotCacheRecords count="0"/>',
      workbook: 'file:///C:/Reports/Data.xlsx',
    };
    expect(parse([cached])?.pivotTables).toEqual([cached]);
    const connected = {
      ...pivot,
      connection: '<connection id="0" name="Sales" type="1"/>',
    };
    expect(parse([connected])?.pivotTables).toEqual([connected]);
  });

  it('refuses parts that are not what they claim', () => {
    expect(parse([{ ...pivot, records: '<other/>' }])).toBeUndefined();
    expect(parse([{ ...pivot, workbook: '' }])).toBeUndefined();
    expect(parse([{ ...pivot, workbook: 'x'.repeat(3_000) }])).toBeUndefined();
    expect(
      parse([{ ...pivot, connection: '<dbPr connection="DSN=x"/>' }])
    ).toBeUndefined();
    expect(parse([{ ...pivot, connections: [] }])).toBeUndefined();
  });
});

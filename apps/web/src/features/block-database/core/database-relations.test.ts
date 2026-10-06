import { describe, expect, it } from 'vitest';
import { relatedRowIds, sameRelatedRows } from './database-relations';
import type { DatabaseViewColumn } from './database-view';
import { formatCellValue } from './table';

const relation: DatabaseViewColumn = {
  id: 'customer',
  name: 'Customer',
  dataType: 'STRING',
  isMultiSelect: true,
  options: [],
  writable: true,
  relation: {
    databaseId: 'db',
    tableId: 'customers',
    labels: { a: 'Acme', b: 'Northwind' },
  },
};
describe('relationship display semantics', () => {
  it('keeps only unique row identities and never turns malformed text into a reference', () => {
    expect(relatedRowIds('["a", "a", null, 2, "b"]')).toEqual(['a', 'b']);
    expect(relatedRowIds('Acme')).toEqual([]);
  });
  it('shows current customer names and marks unavailable records', () => {
    expect(formatCellValue(relation, '["a","b"]')).toBe('Acme, Northwind');
    expect(formatCellValue(relation, '["missing-customer-uuid"]')).toBe(
      'Unavailable record'
    );
  });
});

describe('related rows read again', () => {
  it('are the same rows when every id and name reads the same, in order', () => {
    const shown = [
      { id: 'acme', name: 'Acme' },
      { id: 'globex', name: 'Globex' },
    ];

    expect(
      sameRelatedRows(shown, [
        { id: 'acme', name: 'Acme' },
        { id: 'globex', name: 'Globex' },
      ])
    ).toBe(true);
    expect(
      sameRelatedRows(shown, [
        { id: 'acme', name: 'Acme Corp' },
        { id: 'globex', name: 'Globex' },
      ])
    ).toBe(false);
    expect(
      sameRelatedRows(shown, [
        { id: 'globex', name: 'Globex' },
        { id: 'acme', name: 'Acme' },
      ])
    ).toBe(false);
    expect(sameRelatedRows(shown, [{ id: 'acme', name: 'Acme' }])).toBe(false);
  });
});

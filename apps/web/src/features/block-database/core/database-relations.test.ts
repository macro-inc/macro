import { describe, expect, it } from 'vitest';
import { relatedRowIds } from './database-relations';
import {
  applyDatabaseView,
  type DatabaseViewColumn,
  defaultDatabaseView,
  matchesDatabaseFilter,
} from './database-view';
import { formatCellValue, rowValue } from './table';

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
  it('uses current customer names for search, filtering, sorting, and board labels', () => {
    const rows = [
      { rowId: 'ticket-1', cells: { customer: '["b"]' } },
      { rowId: 'ticket-2', cells: { customer: '["a"]' } },
    ];
    expect(formatCellValue(relation, '["a","b"]')).toBe('Acme, Northwind');
    expect(
      applyDatabaseView(
        rows,
        [relation],
        { ...defaultDatabaseView(), search: 'ACME' },
        rowValue
      ).map((row) => row.rowId)
    ).toEqual(['ticket-2']);
    expect(
      matchesDatabaseFilter('["a"]', relation, {
        id: 'f',
        columnId: 'customer',
        operator: 'equals',
        value: 'Acme',
      })
    ).toBe(true);
    expect(
      matchesDatabaseFilter('["a"]', relation, {
        id: 'f',
        columnId: 'customer',
        operator: 'equals',
        value: 'Northwind',
      })
    ).toBe(false);
    expect(
      applyDatabaseView(
        rows,
        [relation],
        {
          ...defaultDatabaseView(),
          sorts: [{ columnId: 'customer', direction: 'asc' }],
        },
        rowValue
      ).map((row) => row.rowId)
    ).toEqual(['ticket-2', 'ticket-1']);
    const renamed = {
      ...relation,
      relation: {
        ...relation.relation!,
        labels: { a: 'Zenith', b: 'Northwind' },
      },
    };
    expect(
      applyDatabaseView(
        rows,
        [renamed],
        { ...defaultDatabaseView(), search: 'Zenith' },
        rowValue
      ).map((row) => row.rowId)
    ).toEqual(['ticket-2']);
    expect(formatCellValue(relation, '["missing-customer-uuid"]')).toBe(
      'Unavailable record'
    );
  });
});

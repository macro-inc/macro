import type { SortKey } from '@core/database-sql/generated/types';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseViewColumn } from '../core/database-view';
import type { DatabaseRow } from '../core/table';
import { createDatabaseTableModel } from './table-model';

const columns: DatabaseViewColumn[] = ['name', 'notes', 'status'].map((id) => ({
  id,
  name: id,
  dataType: 'STRING',
  options: [],
  isMultiSelect: false,
  writable: true,
}));
const records: DatabaseRow[] = [
  { rowId: 'b', cells: { name: 'B' } },
  { rowId: 'a', cells: { name: 'A' } },
  { rowId: 'draft', cells: {} },
];

describe('database table model', () => {
  it('keeps SQL order and drafts intact while reflecting sort changes', () => {
    createRoot((dispose) => {
      const [sort, setSort] = createSignal<SortKey[]>([
        { column: 'notes', direction: 'descending' },
      ]);
      const onSort = vi.fn((id: string, direction: 'asc' | 'desc' | null) => {
        setSort((keys) => [
          ...keys.filter((key) => key.column !== id),
          ...(direction
            ? [
                {
                  column: id,
                  direction:
                    direction === 'asc'
                      ? ('ascending' as const)
                      : ('descending' as const),
                },
              ]
            : []),
        ]);
      });
      const model = createDatabaseTableModel({
        columns,
        rows: records,
        get sort() {
          return sort();
        },
        widths: {},
        onSort,
      });
      model.sort('name', 'asc');
      expect(sort()).toEqual([
        { column: 'notes', direction: 'descending' },
        { column: 'name', direction: 'ascending' },
      ]);
      expect(model.table.getColumn('name')?.getIsSorted()).toBe('asc');
      expect(model.table.getRowModel().rows.map((row) => row.id)).toEqual([
        'b',
        'a',
        'draft',
      ]);
      model.sort('name', null);
      expect(sort()).toEqual([{ column: 'notes', direction: 'descending' }]);
      dispose();
    });
  });

  it('switches saved layouts without sorting row data again', () => {
    createRoot((dispose) => {
      const [order, setOrder] = createSignal(['status', 'name', 'notes']);
      const [widths, setWidths] = createSignal<Record<string, number | null>>({
        status: 240,
      });
      const model = createDatabaseTableModel({
        columns,
        rows: records,
        sort: [],
        get columnOrder() {
          return order();
        },
        get widths() {
          return widths();
        },
        onSort: vi.fn(),
      });
      expect(model.visibleColumns().map((column) => column.id)).toEqual([
        'status',
        'name',
        'notes',
      ]);
      expect(
        model.table.getFlatHeaders().map((header) => header.column.id)
      ).toEqual(['status', 'name', 'notes']);
      expect(
        model.table
          .getRowModel()
          .rows[0].getVisibleCells()
          .map((cell) => cell.column.id)
      ).toEqual(['status', 'name', 'notes']);
      expect(model.width('status')).toBe(240);
      setOrder(['notes', 'name', 'status']);
      setWidths({ notes: 320 });
      expect(model.visibleColumns().map((column) => column.id)).toEqual([
        'notes',
        'name',
        'status',
      ]);
      expect(model.width('status')).toBeUndefined();
      expect(model.width('notes')).toBe(320);
      dispose();
    });
  });

  it('refreshes cells and schema while keeping durable row and column ids', () => {
    createRoot((dispose) => {
      const [rows, setRows] = createSignal(records);
      const [schema, setSchema] = createSignal(columns);
      const model = createDatabaseTableModel({
        get rows() {
          return rows();
        },
        get columns() {
          return schema();
        },
        sort: [],
        widths: {},
        onSort: vi.fn(),
      });
      const cell = () => model.table.getRowModel().rows[0].getVisibleCells()[0];
      const id = cell().id;
      expect(cell().getValue()).toBe('B');
      setRows([{ rowId: 'b', cells: { name: 'Updated' } }]);
      setSchema(
        columns.map((column) => ({
          ...column,
          name: column.id === 'name' ? 'Title' : column.name,
        }))
      );
      expect(cell().id).toBe(id);
      expect(cell().getValue()).toBe('Updated');
      expect(cell().column.columnDef.meta?.name).toBe('Title');
      dispose();
    });
  });
});

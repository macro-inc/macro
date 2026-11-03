import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createCellSelection } from './cell-selection';

describe('cell positions', () => {
  it('keeps positions stable for value changes and updates them when rows or columns move', () => {
    createRoot((dispose) => {
      const [rows, setRows] = createSignal([
        { id: 'one', name: 'First' },
        { id: 'two', name: 'Second' },
      ]);
      const [columns, setColumns] = createSignal(['name', 'notes']);
      const selection = createCellSelection({
        rows: () => rows().map((row) => row.id),
        columns,
        cellAt: () => undefined,
        onChange: () => {},
        focus: () => {},
      });
      const rowPositions = selection.rowIndex();
      const columnPositions = selection.columnIndex();
      setRows([
        { id: 'one', name: 'Changed' },
        { id: 'two', name: 'Second' },
      ]);
      setColumns(['name', 'notes']);
      expect(selection.rowIndex()).toBe(rowPositions);
      expect(selection.columnIndex()).toBe(columnPositions);

      setRows([
        { id: 'two', name: 'Second' },
        { id: 'three', name: 'Third' },
        { id: 'one', name: 'Changed' },
      ]);
      setColumns(['notes']);
      expect([...selection.rowIndex()]).toEqual([
        ['two', 0],
        ['three', 1],
        ['one', 2],
      ]);
      expect([...selection.columnIndex()]).toEqual([['notes', 0]]);
      dispose();
    });
  });
});

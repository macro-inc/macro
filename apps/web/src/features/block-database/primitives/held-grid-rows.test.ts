import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { DatabaseRow } from '../core/table';
import { createHeldGridRows } from './held-grid-rows';

describe('held grid rows', () => {
  it('keeps the row being typed in at its place after it leaves the view, until the edit ends', () => {
    createRoot((dispose) => {
      const [rows, setRows] = createSignal<DatabaseRow[]>([
        { rowId: 'first', cells: { title: 'First' } },
        { rowId: 'typing', cells: { title: 'Typing' } },
        { rowId: 'last', cells: { title: 'Last' } },
      ]);
      const [knownRows, setKnownRows] = createSignal<DatabaseRow[]>(rows());
      const grid = createHeldGridRows({ rows, knownRows });
      grid.setEditingRowId('typing');
      expect(grid.rows().map((row) => row.rowId)).toEqual([
        'first',
        'typing',
        'last',
      ]);

      setKnownRows([
        { rowId: 'first', cells: { title: 'First' } },
        { rowId: 'typing', cells: { title: 'Changed elsewhere' } },
        { rowId: 'last', cells: { title: 'Last' } },
      ]);
      setRows([
        { rowId: 'first', cells: { title: 'First' } },
        { rowId: 'last', cells: { title: 'Last' } },
      ]);
      expect(grid.rows()).toEqual([
        { rowId: 'first', cells: { title: 'First' } },
        { rowId: 'typing', cells: { title: 'Changed elsewhere' } },
        { rowId: 'last', cells: { title: 'Last' } },
      ]);

      grid.setEditingRowId(undefined);
      expect(grid.rows()).toEqual([
        { rowId: 'first', cells: { title: 'First' } },
        { rowId: 'last', cells: { title: 'Last' } },
      ]);
      dispose();
    });
  });

  it('shows the last values it had for a held row no read still knows', () => {
    createRoot((dispose) => {
      const [rows, setRows] = createSignal<DatabaseRow[]>([
        { rowId: 'typing', cells: { title: 'Typing' } },
        { rowId: 'last', cells: { title: 'Last' } },
      ]);
      const grid = createHeldGridRows({ rows, knownRows: () => [] });
      grid.setEditingRowId('typing');
      expect(grid.rows().map((row) => row.rowId)).toEqual(['typing', 'last']);
      setRows([{ rowId: 'last', cells: { title: 'Last' } }]);
      expect(grid.rows()).toEqual([
        { rowId: 'typing', cells: { title: 'Typing' } },
        { rowId: 'last', cells: { title: 'Last' } },
      ]);
      dispose();
    });
  });

  it('holds nothing for a row that was never shown', () => {
    createRoot((dispose) => {
      const grid = createHeldGridRows({
        rows: () => [{ rowId: 'first', cells: { title: 'First' } }],
        knownRows: () => [{ rowId: 'elsewhere', cells: { title: 'Else' } }],
      });
      grid.setEditingRowId('elsewhere');
      expect(grid.rows()).toEqual([
        { rowId: 'first', cells: { title: 'First' } },
      ]);
      dispose();
    });
  });
});

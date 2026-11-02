import { describe, expect, it } from 'vitest';
import { extendCellRange } from './cell-selection';

const rows = ['one', 'two', 'three', 'four'];
const columns = ['name', 'status', 'notes'];

describe('extending a cell range from the keyboard', () => {
  it('moves the focus corner one cell and keeps the anchor', () => {
    const range = {
      anchor: { rowId: 'two', columnId: 'status' },
      focus: { rowId: 'two', columnId: 'status' },
    };

    expect(
      extendCellRange(range, { key: 'ArrowDown', toEdge: false }, rows, columns)
    ).toEqual({
      anchor: { rowId: 'two', columnId: 'status' },
      focus: { rowId: 'three', columnId: 'status' },
    });
    expect(
      extendCellRange(
        range,
        { key: 'ArrowRight', toEdge: false },
        rows,
        columns
      )
    ).toEqual({
      anchor: { rowId: 'two', columnId: 'status' },
      focus: { rowId: 'two', columnId: 'notes' },
    });
  });

  it('shrinks a range back toward its anchor and reverses past it', () => {
    const range = {
      anchor: { rowId: 'two', columnId: 'status' },
      focus: { rowId: 'three', columnId: 'status' },
    };

    const shrunk = extendCellRange(
      range,
      { key: 'ArrowUp', toEdge: false },
      rows,
      columns
    );
    const reversed = extendCellRange(
      shrunk,
      { key: 'ArrowUp', toEdge: false },
      rows,
      columns
    );

    expect(shrunk).toEqual({
      anchor: { rowId: 'two', columnId: 'status' },
      focus: { rowId: 'two', columnId: 'status' },
    });
    expect(reversed).toEqual({
      anchor: { rowId: 'two', columnId: 'status' },
      focus: { rowId: 'one', columnId: 'status' },
    });
  });

  it('stops at the edges of the grid', () => {
    const range = {
      anchor: { rowId: 'two', columnId: 'status' },
      focus: { rowId: 'one', columnId: 'name' },
    };

    expect(
      extendCellRange(range, { key: 'ArrowUp', toEdge: false }, rows, columns)
    ).toEqual(range);
    expect(
      extendCellRange(range, { key: 'ArrowLeft', toEdge: false }, rows, columns)
    ).toEqual(range);
    expect(
      extendCellRange(
        {
          anchor: { rowId: 'two', columnId: 'status' },
          focus: { rowId: 'four', columnId: 'notes' },
        },
        { key: 'ArrowDown', toEdge: false },
        rows,
        columns
      )
    ).toEqual({
      anchor: { rowId: 'two', columnId: 'status' },
      focus: { rowId: 'four', columnId: 'notes' },
    });
  });

  it('jumps to the edge of the data with Cmd/Ctrl and to the row ends with Home and End', () => {
    const range = {
      anchor: { rowId: 'two', columnId: 'status' },
      focus: { rowId: 'two', columnId: 'status' },
    };

    expect(
      extendCellRange(range, { key: 'ArrowDown', toEdge: true }, rows, columns)
    ).toEqual({
      anchor: { rowId: 'two', columnId: 'status' },
      focus: { rowId: 'four', columnId: 'status' },
    });
    expect(
      extendCellRange(range, { key: 'ArrowUp', toEdge: true }, rows, columns)
    ).toEqual({
      anchor: { rowId: 'two', columnId: 'status' },
      focus: { rowId: 'one', columnId: 'status' },
    });
    expect(
      extendCellRange(range, { key: 'ArrowLeft', toEdge: true }, rows, columns)
    ).toEqual({
      anchor: { rowId: 'two', columnId: 'status' },
      focus: { rowId: 'two', columnId: 'name' },
    });
    expect(
      extendCellRange(range, { key: 'Home', toEdge: false }, rows, columns)
    ).toEqual({
      anchor: { rowId: 'two', columnId: 'status' },
      focus: { rowId: 'two', columnId: 'name' },
    });
    expect(
      extendCellRange(range, { key: 'End', toEdge: false }, rows, columns)
    ).toEqual({
      anchor: { rowId: 'two', columnId: 'status' },
      focus: { rowId: 'two', columnId: 'notes' },
    });
  });

  it('leaves a range whose focus left the view unchanged', () => {
    const range = {
      anchor: { rowId: 'two', columnId: 'status' },
      focus: { rowId: 'gone', columnId: 'status' },
    };

    expect(
      extendCellRange(range, { key: 'ArrowDown', toEdge: false }, rows, columns)
    ).toBe(range);
  });
});

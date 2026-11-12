import { For, Index, type JSX } from 'solid-js';
import './sheet-stories.css';

const ROW_HEADER = 30;
const COLUMN_HEADER = 24;
const ROW_HEIGHT = 30;
const LETTERS = 'ABCDEFGH';

/** Where a collaborator is in the sheet, and who they are. */
export type SheetCursor = {
  row: number;
  column: number;
  /** A range that runs down from the cell. */
  rows?: number;
  name: string;
  tone: 'agent' | 'person' | 'self';
  icon?: JSX.Element;
};

export const cellAddress = (row: number, column: number) =>
  `${LETTERS[column]}${row + 1}`;

/**
 * A sheet's grid as the app draws it: lettered columns, numbered rows, and
 * each collaborator's cursor on its cell. Cursors glide between cells, so pass
 * the same list in the same order as they move.
 */
export function SheetGrid(props: {
  widths: number[];
  rows: JSX.Element[][];
  /** Columns whose values sit against the right edge, as numbers do. */
  numeric?: number[];
  cursors?: SheetCursor[];
}) {
  const left = (column: number) =>
    ROW_HEADER +
    props.widths.slice(0, column).reduce((sum, width) => sum + width, 0);
  return (
    <div
      class="sheet-grid"
      style={{
        '--sheet-columns': `${ROW_HEADER}px ${props.widths.map((width) => `${width}px`).join(' ')}`,
      }}
    >
      <div class="sheet-grid-row sheet-grid-letters">
        <span />
        <For each={props.widths}>
          {(_, column) => <span>{LETTERS[column()]}</span>}
        </For>
      </div>
      <For each={props.rows}>
        {(cells, row) => (
          <div class="sheet-grid-row">
            <span class="sheet-grid-number">{row() + 1}</span>
            <For each={cells}>
              {(cell, column) => (
                <span
                  class="sheet-grid-cell"
                  data-numeric={props.numeric?.includes(column())}
                >
                  {cell}
                </span>
              )}
            </For>
          </div>
        )}
      </For>
      <Index each={props.cursors}>
        {(cursor) => (
          <span
            class="sheet-grid-cursor"
            data-tone={cursor().tone}
            style={{
              left: `${left(cursor().column)}px`,
              top: `${COLUMN_HEADER + cursor().row * ROW_HEIGHT}px`,
              width: `${props.widths[cursor().column]}px`,
              height: `${(cursor().rows ?? 1) * ROW_HEIGHT}px`,
            }}
          >
            <b>
              {cursor().icon}
              {cursor().name}
            </b>
          </span>
        )}
      </Index>
    </div>
  );
}

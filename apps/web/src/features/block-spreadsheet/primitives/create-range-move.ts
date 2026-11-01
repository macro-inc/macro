import { Telemetry } from '@macro-inc/observability';
import type { RangeMove } from '@macro-inc/spreadsheet/workbook-structure';
import { type Accessor, createSignal } from 'solid-js';
import {
  type CellPosition,
  type CellSelection,
  selectionBounds,
} from '../core/grid-selection';
import { moveReplacesValues } from '../core/sheet-operations';
import type { SpreadsheetWorkbookSheet } from '../core/workbook-document';
import type { SpreadsheetStore } from './create-spreadsheet-store';

type PendingMove = {
  move: RangeMove;
  selection: CellSelection;
  before: SpreadsheetWorkbookSheet[];
  revision: number;
  replacesValues: boolean;
};

/**
 * Move the selected cells to another place on their sheet. Replacing values
 * waits for confirmation. The move is one revision-checked structural change,
 * so a collaborator's edit in the meantime cancels it and undo reverses it.
 */
export function createRangeMove(options: {
  /** A saved workbook's document, recorded on traces. */
  documentId?: string;
  store: Pick<
    SpreadsheetStore,
    'workbook' | 'revision' | 'activeSheetId' | 'applyStructure'
  >;
  canMove: Accessor<boolean>;
  moveRange: (
    sheets: SpreadsheetWorkbookSheet[],
    move: RangeMove
  ) => Promise<SpreadsheetWorkbookSheet[]>;
  setBusy: (busy: boolean) => void;
  setNotice: (message: string) => void;
  select: (anchor: CellPosition, focus: CellPosition) => void;
}) {
  const [confirming, setConfirming] = createSignal<PendingMove>();

  function apply(pending: PendingMove) {
    const { move, before } = pending;
    return Telemetry.span('spreadsheet.move_range', async (span) => {
      if (options.documentId) span.setAttr('document.id', options.documentId);
      span.setAttr('spreadsheet.sheet_id', move.sheetId);
      span.setAttr(
        'spreadsheet.move.cells',
        (move.source.bottom - move.source.top + 1) *
          (move.source.right - move.source.left + 1)
      );
      span.setAttr('spreadsheet.move.rows', move.rows);
      span.setAttr('spreadsheet.move.columns', move.columns);
      span.setAttr('spreadsheet.move.replaces_values', pending.replacesValues);
      options.setBusy(true);
      try {
        const next = await span.span('spreadsheet.move_range.calculate', () =>
          options.moveRange(before, move)
        );
        await span.span('spreadsheet.move_range.commit', async () =>
          options.store.applyStructure(before, next, pending.revision)
        );
        if (options.store.activeSheetId() !== move.sheetId) return;
        const { anchor, focus } = pending.selection;
        options.select(
          { row: anchor.row + move.rows, column: anchor.column + move.columns },
          { row: focus.row + move.rows, column: focus.column + move.columns }
        );
      } catch (error) {
        span.error(error);
        options.setNotice(
          error instanceof Error ? error.message : 'Unable to move cells.'
        );
      } finally {
        options.setBusy(false);
      }
    });
  }

  return {
    /** A move that replaces values, waiting for confirmation. */
    confirming,
    move(selection: CellSelection, rows: number, columns: number) {
      if (!options.canMove() || (!rows && !columns)) return;
      const before = structuredClone(options.store.workbook());
      const sheetId = options.store.activeSheetId();
      const move = {
        sheetId,
        source: selectionBounds(selection),
        rows,
        columns,
      };
      const cells = before.find((sheet) => sheet.id === sheetId)?.cells ?? {};
      const pending: PendingMove = {
        move,
        selection,
        before,
        revision: options.store.revision(),
        replacesValues: moveReplacesValues(cells, move),
      };
      if (!pending.replacesValues) return apply(pending);
      setConfirming(pending);
    },
    confirm() {
      const pending = confirming();
      setConfirming(undefined);
      if (pending) return apply(pending);
    },
    cancel: () => setConfirming(undefined),
  };
}

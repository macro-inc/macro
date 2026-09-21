import { type LoroDoc, UndoManager, type Value } from 'loro-crdt';
import { formulaReferencesSheet } from './sheet-references';
import { readSpreadsheetSheets } from './spreadsheet-sheet-registry';
import { readSpreadsheetWorkbook } from './workbook-document';

const structuralMaps = new Set([
  'spreadsheetSheetNames',
  'spreadsheetSheetOrder',
  'spreadsheetDeletedSheets',
  'spreadsheetSheetRevivals',
  'spreadsheetSheetRetentions',
]);
type Scalar = string | number | boolean | null;
type HistoryChange = {
  map: string;
  key: string;
  before: Scalar;
  after: Scalar;
};
type HistoryMetadata =
  | {
      kind: 'structural' | 'edit';
      changes: HistoryChange[];
      axisWorkbook?: string;
    }
  | { kind: 'unavailable' };

function metadata(value: Value | undefined): HistoryMetadata | undefined {
  if (!value || typeof value !== 'object' || !('kind' in value)) return;
  // These values are created only by this local UndoManager, never by peers.
  return value as HistoryMetadata;
}

function scalar(doc: LoroDoc, map: string, key: string): Scalar {
  const value = doc.getMap(map).get(key);
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
    ? value
    : null;
}

/** Protect peer edits; preflight structural history before emitting any ops. */
export function createSpreadsheetHistory(doc: LoroDoc, onChange: () => void) {
  let reversing: HistoryMetadata | undefined;
  const history = new UndoManager(doc, {
    mergeInterval: 0,
    maxUndoSteps: 100,
    onPush: (_isUndo, _range, event) => {
      onChange();
      if (!event) {
        const popped = reversing;
        reversing = undefined;
        // Redo metadata describes the actual inverse after Loro has reconciled
        // it with remote operations, rather than blindly reversing old data.
        const value =
          popped && popped.kind !== 'unavailable'
            ? {
                kind: popped.kind,
                ...(popped.axisWorkbook
                  ? {
                      axisWorkbook: JSON.stringify(
                        readSpreadsheetWorkbook(doc)
                      ),
                    }
                  : {}),
                changes: popped.changes.map((change) => ({
                  ...change,
                  after: scalar(doc, change.map, change.key),
                })),
              }
            : (popped ?? null);
        return { value, cursors: [] };
      }
      const structural = event.events.some((change) =>
        structuralMaps.has(String(change.path[0]))
      );
      let before: LoroDoc | undefined;
      try {
        if (structural) before = doc.forkAt(event.from);
        const changes = event.events.flatMap((change) => {
          const map = String(change.path[0]);
          if (change.diff.type !== 'map' || !map.startsWith('spreadsheet'))
            return [];
          return Object.keys(change.diff.updated).map((key) => ({
            map,
            key,
            // Ordinary history only needs the saved result for its conflict
            // check; it never constructs an inverse preview or forks the doc.
            before: before ? scalar(before, map, key) : null,
            after: scalar(doc, map, key),
          }));
        });
        return {
          value: {
            kind: structural ? 'structural' : 'edit',
            changes,
            ...(event.origin === 'spreadsheet-axis-change'
              ? { axisWorkbook: JSON.stringify(readSpreadsheetWorkbook(doc)) }
              : {}),
          },
          cursors: [],
        };
      } catch {
        return { value: { kind: 'unavailable' }, cursors: [] };
      } finally {
        before?.free();
      }
    },
  });

  function apply(direction: 'undo' | 'redo'): string | undefined {
    const item = metadata(
      direction === 'undo' ? history.topUndoValue() : history.topRedoValue()
    );
    const action = direction === 'undo' ? 'Undo' : 'Redo';
    if (item?.kind === 'unavailable')
      return `${action} is unavailable because this sheet change could not be checked safely.`;
    if (
      item?.axisWorkbook &&
      item.axisWorkbook !== JSON.stringify(readSpreadsheetWorkbook(doc))
    )
      return `${action} is blocked because the workbook changed after moving rows or columns. Newer changes have been kept.`;
    if (
      item?.changes.some(
        (change) =>
          scalar(doc, change.map, change.key) !== change.after ||
          doc.getMap(change.map).getLastEditor(change.key) !== doc.peerIdStr
      )
    )
      return `${action} is blocked because a newer collaborator edit would be overwritten. Their changes have been kept.`;
    let preview: LoroDoc | undefined;
    try {
      if (item?.kind === 'structural') {
        preview = doc.fork();
        for (const change of item.changes) {
          const map = preview.getMap(change.map);
          if (change.before === null) map.delete(change.key);
          else map.set(change.key, change.before);
        }
        const namesAfter = new Map(
          readSpreadsheetSheets(preview).map((sheet) => [
            sheet.id,
            sheet.name.toLowerCase(),
          ])
        );
        const disappearing = readSpreadsheetSheets(doc).filter(
          (sheet) => namesAfter.get(sheet.id) !== sheet.name.toLowerCase()
        );
        if (disappearing.length) {
          for (const sheet of readSpreadsheetWorkbook(preview)) {
            for (const cell of Object.values(sheet.cells)) {
              if (cell.format === 'text') continue;
              const referenced = disappearing.find((target) =>
                formulaReferencesSheet(cell.value, target.name)
              );
              if (referenced)
                return `${action} would rename or remove “${referenced.name}”, which a formula references. Update those references before changing the sheet.`;
            }
          }
        }
      }
    } catch {
      return `${action} is unavailable because this sheet change could not be checked safely.`;
    } finally {
      preview?.free();
    }
    // onPop is called after Loro applies the inverse. Capture the current
    // values here instead so the next stack item describes the actual redo.
    reversing = item
      ? {
          kind: item.kind,
          ...(item.axisWorkbook ? { axisWorkbook: item.axisWorkbook } : {}),
          changes: item.changes.map((change) => ({
            ...change,
            before: scalar(doc, change.map, change.key),
          })),
        }
      : item;
    history[direction]();
    reversing = undefined;
  }

  return {
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    undo: () => apply('undo'),
    redo: () => apply('redo'),
    free: () => history.free(),
  };
}

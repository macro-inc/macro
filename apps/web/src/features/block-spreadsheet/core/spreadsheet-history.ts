import {
  type Frontiers,
  type LoroDoc,
  type LoroEventBatch,
  UndoManager,
  type Value,
} from 'loro-crdt';
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
type MapValues = Map<string, Record<string, unknown>>;
/** The small structural maps as they were at `version`. */
type Structure = { version: Frontiers; maps: MapValues };
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

function scalarValue(value: unknown): Scalar {
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
    ? value
    : null;
}

function scalar(doc: LoroDoc, map: string, key: string): Scalar {
  return scalarValue(doc.getMap(map).get(key));
}

function readStructure(doc: LoroDoc): Structure {
  return {
    version: doc.frontiers(),
    maps: new Map(
      [...structuralMaps].map((map) => [map, doc.getMap(map).toJSON()])
    ),
  };
}

/** The copy holds at `from` unless it was read after `from`. */
function structureAt(
  doc: LoroDoc,
  structure: Structure | undefined,
  from: Frontiers
): MapValues | undefined {
  try {
    const order = structure && doc.cmpFrontiers(structure.version, from);
    return order === -1 || order === 0 ? structure?.maps : undefined;
  } catch {
    return undefined;
  }
}

/** Earlier values of the keys a commit changed, at a cost of that commit. */
function diffEarlierValues(doc: LoroDoc, event: LoroEventBatch): MapValues {
  const values: MapValues = new Map();
  for (const [container, diff] of doc.diff(event.to, event.from, false)) {
    const root = /^cid:root-(.*):Map$/.exec(container)?.[1];
    if (root && diff.type === 'map') values.set(root, diff.updated);
  }
  return values;
}

/** Protect peer edits; preflight structural history before emitting any ops. */
export function createSpreadsheetHistory(doc: LoroDoc, onChange: () => void) {
  let reversing: HistoryMetadata | undefined;
  // Forking or diffing a large import to find earlier values takes seconds.
  // The structural maps stay small, so a copy refreshed after each change to
  // them answers those keys; anything it cannot answer is diffed instead.
  let structure: Structure | undefined = readStructure(doc);
  const subscriptions = [...structuralMaps].map((map) =>
    doc.getMap(map).subscribe((batch) => {
      // Local changes refresh the copy once their own history entry exists.
      if (batch.by !== 'local') structure = readStructure(doc);
    })
  );
  const history = new UndoManager(doc, {
    mergeInterval: 0,
    maxUndoSteps: 100,
    onPush: (_isUndo, _range, event) => {
      onChange();
      if (!event) {
        structure = readStructure(doc);
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
      const known = structural
        ? structureAt(doc, structure, event.from)
        : undefined;
      if (structural) structure = readStructure(doc);
      try {
        // Keys of sheets this change created had no earlier value.
        const names = known?.get('spreadsheetSheetNames');
        const created = new Set(
          event.events.flatMap((change) =>
            names &&
            String(change.path[0]) === 'spreadsheetSheetNames' &&
            change.diff.type === 'map'
              ? Object.keys(change.diff.updated).filter(
                  (id) => !Object.hasOwn(names, id)
                )
              : []
          )
        );
        let diffed: MapValues | undefined;
        const earlier = (map: string, key: string, after: Scalar): Scalar => {
          // Ordinary history only needs the saved result for its conflict
          // check; it never constructs an inverse preview.
          if (!structural) return null;
          const values = known?.get(map);
          if (values) return scalarValue(values[key]);
          const separator = key.indexOf('!');
          if (created.has(separator > 0 ? key.slice(0, separator) : key))
            return null;
          diffed ??= diffEarlierValues(doc, event);
          const earlierValues = diffed.get(map);
          // A key absent from the reverse diff held the same value before.
          return earlierValues && Object.hasOwn(earlierValues, key)
            ? scalarValue(earlierValues[key])
            : after;
        };
        const changes = event.events.flatMap((change) => {
          const map = String(change.path[0]);
          if (change.diff.type !== 'map' || !map.startsWith('spreadsheet'))
            return [];
          const updated = change.diff.updated;
          return Object.keys(updated).map((key) => {
            const after = scalarValue(updated[key]);
            return { map, key, before: earlier(map, key, after), after };
          });
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
    free: () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      history.free();
    },
  };
}

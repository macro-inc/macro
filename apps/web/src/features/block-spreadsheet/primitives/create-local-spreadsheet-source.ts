import { LoroDoc } from 'loro-crdt';
import { onCleanup } from 'solid-js';
import type { SpreadsheetDocumentSource } from '../context/spreadsheet-source';
import {
  type SpreadsheetCells,
  writeSpreadsheetCells,
} from '../core/spreadsheet-document';

/** A standalone editor source for previews and integration tests. */
export function createLocalSpreadsheetSource(
  initialCells: SpreadsheetCells = {}
): SpreadsheetDocumentSource {
  const doc = new LoroDoc();
  writeSpreadsheetCells(doc, initialCells);
  onCleanup(() => doc.free());
  return {
    doc: () => doc,
    ready: () => true,
    error: () => undefined,
    status: () => 'local',
    peers: () => [],
    setSelection: () => {},
  };
}

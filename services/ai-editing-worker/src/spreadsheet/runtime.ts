import type {
  SpreadsheetRequest,
  SpreadsheetResponse,
} from '@macro-inc/spreadsheet/ai-types';
import {
  calculateSpreadsheetForAi,
  prepareSpreadsheetEdit,
  readSpreadsheetForAi,
} from '@macro-inc/spreadsheet/ai-workbook';
import type { SpreadsheetCalculator } from '@macro-inc/spreadsheet/calculation';
import { validateSpreadsheetDocument } from '@macro-inc/spreadsheet/document-validation';
import { LoroDoc } from 'loro-crdt';
import { nextAiPeerId } from '../ai-editing/awareness/ai-peer';

import {
  DocumentRequestError as SpreadsheetRequestError,
  type DocumentStorage as SpreadsheetStorage,
} from '../document-storage';

export {
  createDocumentStorage as createSpreadsheetStorage,
  DocumentRequestError as SpreadsheetRequestError,
  type DocumentStorage as SpreadsheetStorage,
} from '../document-storage';

export async function runSpreadsheetRequest(
  request: SpreadsheetRequest,
  storage: SpreadsheetStorage,
  calculator: SpreadsheetCalculator,
  signal: AbortSignal,
  options?: { now?: () => number }
): Promise<SpreadsheetResponse> {
  // Timers cannot interrupt synchronous WASM. A monotonic deadline is checked
  // after calculation and before commit; the platform supplies the hard CPU cap.
  const now = options?.now ?? (() => performance.now());
  const deadline = now() + 30_000;
  const checkDeadline = () => {
    signal.throwIfAborted();
    if (now() >= deadline)
      throw new SpreadsheetRequestError(
        'The spreadsheet calculation exceeded its time budget. Use a smaller workbook or simpler formulas.',
        504
      );
  };
  const { snapshot, revision } = await storage.load(signal);
  checkDeadline();
  const doc = new LoroDoc();
  try {
    doc.import(snapshot);
    validateSpreadsheetDocument(doc);
    if (request.action === 'read') {
      const response = readSpreadsheetForAi(doc, revision, request, calculator);
      checkDeadline();
      return response;
    }
    if (request.action === 'calculate') {
      const response = calculateSpreadsheetForAi(
        doc,
        revision,
        request,
        calculator
      );
      checkDeadline();
      return response;
    }
    if (request.expectedRevision !== revision)
      throw new SpreadsheetRequestError(
        'The spreadsheet changed since it was read. Read it again before editing.',
        409
      );
    const edit = prepareSpreadsheetEdit(
      doc,
      request,
      calculator,
      nextAiPeerId()
    );
    checkDeadline();
    const committed = await storage.commit(
      request.expectedRevision,
      edit.update,
      signal
    );
    return {
      action: 'edit',
      ...committed,
      changes: edit.changes,
      sheets: edit.sheets,
      warnings: edit.warnings,
    };
  } finally {
    doc.free();
  }
}

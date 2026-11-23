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
import { match } from 'ts-pattern';
import { nextAiPeerId } from '../ai-editing/awareness/ai-peer';
import {
  createSyncDocumentStorage,
  SyncDocumentError,
  type SyncDocumentStorage,
} from '../sync-document';

export class SpreadsheetRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 502 | 504
  ) {
    super(message);
    this.name = 'SpreadsheetRequestError';
  }
}

export type SpreadsheetStorage = SyncDocumentStorage;

/** Surface actionable failures without leaking an upstream error body or token. */
function spreadsheetError(error: SyncDocumentError): SpreadsheetRequestError {
  return match(error.failure)
    .with(
      'conflict',
      () =>
        new SpreadsheetRequestError(
          'The spreadsheet changed since it was read. Read the affected ranges again and retry with the new revision.',
          409
        )
    )
    .with(
      'denied',
      () =>
        new SpreadsheetRequestError(
          'You do not have the required access to this spreadsheet.',
          error.status
        )
    )
    .with(
      'not_found',
      () =>
        new SpreadsheetRequestError('The spreadsheet could not be found.', 404)
    )
    .with('too_large', () =>
      error.operation === 'read'
        ? new SpreadsheetRequestError(
            'This workbook exceeds the 4 MiB snapshot limit for AI tools. Reduce its size before using spreadsheet tools.',
            413
          )
        : new SpreadsheetRequestError(
            'The spreadsheet update was rejected by the sync service. Read the workbook and use a smaller valid batch.',
            413
          )
    )
    .with(
      'rejected',
      () =>
        new SpreadsheetRequestError(
          'The spreadsheet update was rejected by the sync service. Read the workbook and use a smaller valid batch.',
          400
        )
    )
    .with(
      'unavailable',
      () =>
        new SpreadsheetRequestError(
          'The spreadsheet sync service is unavailable. Please retry.',
          502
        )
    )
    .with('invalid_response', () =>
      error.operation === 'read'
        ? new SpreadsheetRequestError(
            'The sync service returned an invalid spreadsheet response.',
            502
          )
        : new SpreadsheetRequestError(
            'The sync service did not confirm the update. Read the workbook before retrying.',
            502
          )
    )
    .exhaustive();
}

async function withSpreadsheetErrors<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof SyncDocumentError) throw spreadsheetError(error);
    throw error;
  }
}

/** Sync validates the signed token's document ID and minimum permission per call. */
export function createSpreadsheetStorage(
  syncBase: string,
  documentId: string,
  documentToken: string,
  fetcher?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>
): SpreadsheetStorage {
  const storage = createSyncDocumentStorage(
    syncBase,
    documentId,
    documentToken,
    fetcher
  );
  return {
    load: (signal) => withSpreadsheetErrors(storage.load(signal)),
    commit: (expectedRevision, update, signal) =>
      withSpreadsheetErrors(storage.commit(expectedRevision, update, signal)),
  };
}

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

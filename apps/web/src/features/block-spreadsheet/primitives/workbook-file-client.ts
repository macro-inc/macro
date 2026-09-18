import type {
  WorkbookFileData,
  WorkbookFileExport,
  WorkbookFileReply,
  WorkbookFileRequest,
} from '../core/workbook-file-types';
import {
  XLSX_MAX_BYTES,
  XLSX_OPERATION_TIMEOUT_MS,
} from '../core/workbook-file-types';

/** A fresh lazy worker per operation: cancellation frees the parser and its heap. */
function requestWorkbookFile(
  request: WorkbookFileRequest,
  signal?: AbortSignal
): Promise<WorkbookFileReply> {
  if (signal?.aborted)
    return Promise.reject(new Error('Excel operation cancelled.'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('../workers/xlsx-worker.ts', import.meta.url),
      { type: 'module' }
    );
    let finished = false;
    const finish = (reply?: WorkbookFileReply, error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else if (reply?.kind === 'error') reject(new Error(reply.message));
      else if (reply) resolve(reply);
    };
    const abort = () =>
      finish(undefined, new Error('Excel operation cancelled.'));
    const timeout = setTimeout(
      () =>
        finish(
          undefined,
          new Error('Excel processing took too long. Try a smaller workbook.')
        ),
      XLSX_OPERATION_TIMEOUT_MS
    );
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<WorkbookFileReply>) =>
      finish(event.data);
    worker.onerror = () =>
      finish(
        undefined,
        new Error(
          'Excel processing failed. Try a smaller, unencrypted .xlsx workbook.'
        )
      );
    worker.onmessageerror = () =>
      finish(
        undefined,
        new Error('Excel processing returned an invalid response.')
      );
    try {
      if (request.kind === 'decode')
        worker.postMessage(request, [request.bytes.buffer]);
      else worker.postMessage(request);
    } catch {
      finish(
        undefined,
        new Error('Unable to send the workbook to the Excel processor.')
      );
    }
  });
}

export async function importWorkbookFile(
  bytes: Uint8Array,
  signal?: AbortSignal
): Promise<WorkbookFileData> {
  if (bytes.byteLength > XLSX_MAX_BYTES)
    throw new Error('Choose an Excel workbook up to 5 MB.');
  // Transfer a copy: callers may retain the original file until import is confirmed.
  const reply = await requestWorkbookFile(
    { kind: 'decode', bytes: bytes.slice() },
    signal
  );
  if (reply.kind !== 'decoded')
    throw new Error('Unexpected Excel import response.');
  return reply.workbook;
}
export async function exportWorkbookFile(
  workbook: Pick<WorkbookFileData, 'sheets'>,
  signal?: AbortSignal
): Promise<WorkbookFileExport> {
  const reply = await requestWorkbookFile({ kind: 'encode', workbook }, signal);
  if (reply.kind !== 'encoded')
    throw new Error('Unexpected Excel export response.');
  return reply.file;
}

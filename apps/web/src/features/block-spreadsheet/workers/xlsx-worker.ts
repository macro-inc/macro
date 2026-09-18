/// <reference lib="webworker" />

import type {
  WorkbookFileReply,
  WorkbookFileRequest,
} from '../core/workbook-file-types';
import { decodeXlsx, encodeXlsx } from '../core/xlsx-codec';

declare const self: DedicatedWorkerGlobalScope;
self.onmessage = async (event: MessageEvent<WorkbookFileRequest>) => {
  try {
    const reply: WorkbookFileReply =
      event.data.kind === 'decode'
        ? { kind: 'decoded', workbook: await decodeXlsx(event.data.bytes) }
        : { kind: 'encoded', file: await encodeXlsx(event.data.workbook) };
    if (reply.kind === 'encoded')
      self.postMessage(reply, [reply.file.bytes.buffer]);
    else self.postMessage(reply);
  } catch (error) {
    self.postMessage({
      kind: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Unable to process this Excel workbook.',
    } satisfies WorkbookFileReply);
  }
};

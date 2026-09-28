import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type WorkbookFileReply,
  XLSX_MAX_BYTES,
  XLSX_OPERATION_TIMEOUT_MS,
} from '../core/workbook-file-types';
import { exportWorkbookFile, importWorkbookFile } from './workbook-file-client';

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage?: (event: MessageEvent<WorkbookFileReply>) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    TestWorker.instances.push(this);
  }
  reply(value: WorkbookFileReply) {
    this.onmessage?.({ data: value } as MessageEvent<WorkbookFileReply>);
  }
}
afterEach(() => {
  TestWorker.instances = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('lazy Excel worker client', () => {
  it('creates a worker only when requested and cleans up successful imports', async () => {
    vi.stubGlobal('Worker', TestWorker);
    expect(TestWorker.instances).toHaveLength(0);
    const bytes = new Uint8Array([1, 2, 3]);
    const result = importWorkbookFile(bytes);
    const worker = TestWorker.instances[0];
    const workbook = { sheets: [], warnings: ['preview before applying'] };
    worker.reply({ kind: 'decoded', workbook });
    expect(await result).toBe(workbook);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.postMessage.mock.calls[0][0].bytes).not.toBe(bytes);
  });
  it('terminates parsing on abort, timeout and worker error', async () => {
    vi.stubGlobal('Worker', TestWorker);
    vi.useFakeTimers();
    const abort = new AbortController();
    const cancelled = importWorkbookFile(new Uint8Array(), abort.signal);
    abort.abort();
    await expect(cancelled).rejects.toThrow('cancelled');
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
    const timed = exportWorkbookFile({ sheets: [] });
    const assertion = expect(timed).rejects.toThrow('too long');
    await vi.advanceTimersByTimeAsync(XLSX_OPERATION_TIMEOUT_MS);
    await assertion;
    expect(TestWorker.instances[1].terminate).toHaveBeenCalledOnce();
    const failed = importWorkbookFile(new Uint8Array());
    TestWorker.instances[2].onerror?.();
    await expect(failed).rejects.toThrow('failed');
    expect(TestWorker.instances[2].terminate).toHaveBeenCalledOnce();
  });
  it('does not construct a parser for an oversized file or an already cancelled operation', async () => {
    vi.stubGlobal('Worker', TestWorker);
    await expect(
      importWorkbookFile(new Uint8Array(XLSX_MAX_BYTES + 1))
    ).rejects.toThrow('5 MB');
    const abort = new AbortController();
    abort.abort();
    await expect(
      importWorkbookFile(new Uint8Array(), abort.signal)
    ).rejects.toThrow('cancelled');
    expect(TestWorker.instances).toHaveLength(0);
  });
});

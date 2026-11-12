// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const workers = vi.hoisted(() => ({ started: 0 }));

// Runs the real worker code in-process in place of a browser worker.
vi.mock('../../workers/file-hash/hash-worker?worker', async () => {
  const { installHashWorker } = await import(
    '../../workers/file-hash/hash-worker'
  );
  class InProcessWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    constructor() {
      workers.started += 1;
    }
    postMessage(request: unknown) {
      const port = {
        postMessage: (response: unknown) =>
          this.onmessage?.({ data: response }),
        onmessage: null as ((event: MessageEvent) => void) | null,
      };
      installHashWorker(port);
      port.onmessage?.({ data: request } as MessageEvent);
    }
    terminate() {}
  }
  return { default: InProcessWorker };
});

import { hashFile } from './hashFile';

function sha256Hex(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A file whose whole-file read throws, so only chunked reads can hash it. */
function unreadableWhole(bytes: Uint8Array<ArrayBuffer>, name: string) {
  const file = new File([bytes], name);
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => {
      throw new Error('Must not read the whole file into memory');
    },
  });
  return file;
}

describe('hashFile', () => {
  it('hashes a small file in one read without starting a worker', async () => {
    const bytes = new TextEncoder().encode('quarterly summary');
    const started = workers.started;

    expect(await hashFile(new File([bytes], 'summary.txt'))).toBe(
      sha256Hex(bytes)
    );
    expect(workers.started).toBe(started);
  });

  it('streams a large file through a worker without reading it whole', async () => {
    const bytes = new Uint8Array(40 * 1024 * 1024).map(
      (_, i) => (i * 31) % 251
    );
    const started = workers.started;

    expect(await hashFile(unreadableWhole(bytes, 'scan.pdf'))).toBe(
      sha256Hex(bytes)
    );
    expect(workers.started).toBe(started + 1);
  });

  it('reports how much of a streamed file it has hashed', async () => {
    const bytes = new Uint8Array(40 * 1024 * 1024).fill(7);
    const fractions: number[] = [];

    await hashFile(unreadableWhole(bytes, 'scan.pdf'), (fraction) =>
      fractions.push(fraction)
    );

    expect(fractions).toEqual([0.2, 0.4, 0.6, 0.8, 1]);
  });
});

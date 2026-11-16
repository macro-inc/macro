import { describe, expect, it, vi } from 'vitest';

type Reply = (data: unknown) => void;

const workers = vi.hoisted(() => ({
  alive: 0,
  mostAlive: 0,
  replies: [] as Reply[],
}));

// A worker that finishes only when the test answers it.
vi.mock('../../workers/folder-upload/zip-worker?worker', () => ({
  default: class {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    constructor() {
      workers.alive += 1;
      workers.mostAlive = Math.max(workers.mostAlive, workers.alive);
    }
    postMessage(request: { taskId: string }) {
      workers.replies.push((data) =>
        this.onmessage?.({
          data: { taskId: request.taskId, type: 'complete', data },
        })
      );
    }
    terminate() {
      workers.alive -= 1;
    }
  },
}));

import { zipFiles } from './zipWorkerClient';

function finishNext() {
  const reply = workers.replies.shift();
  if (!reply) throw new Error('no worker is waiting to finish');
  reply({ zipBlob: new Blob(['zip']), sha256: 'ab'.repeat(32) });
}

describe('zipFiles', () => {
  it('zips at most three folders at once and starts the next as one ends', async () => {
    const zips = Array.from({ length: 5 }, (_, index) =>
      zipFiles(
        `Folder ${index}`,
        [new File(['a'], 'a.txt')],
        [{ path: `Folder ${index}/a.txt` }]
      )
    );

    await vi.waitFor(() => expect(workers.replies).toHaveLength(3));
    expect(workers.alive).toBe(3);

    finishNext();
    await vi.waitFor(() => expect(workers.replies).toHaveLength(3));
    expect(workers.alive).toBe(3);

    for (let finished = 1; finished < 5; finished++) {
      await vi.waitFor(() => expect(workers.replies.length).toBeGreaterThan(0));
      finishNext();
    }

    const zipped = await Promise.all(zips);
    expect(zipped.map((file) => file.name)).toEqual([
      'Folder 0.zip',
      'Folder 1.zip',
      'Folder 2.zip',
      'Folder 3.zip',
      'Folder 4.zip',
    ]);
    expect(workers.mostAlive).toBe(3);
    expect(workers.alive).toBe(0);
  });
});

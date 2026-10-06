import JSZip from 'jszip';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

type WorkerMessage = { type: string; data: { zipBlob?: Blob } };

const posted: WorkerMessage[] = [];

beforeAll(async () => {
  vi.stubGlobal('self', {
    postMessage: (message: WorkerMessage) => posted.push(message),
  });
  await import('../../workers/folder-upload/zip-worker.js');
});

afterEach(() => {
  posted.length = 0;
});

async function runZip(
  files: { path: string; contents: string }[],
  folderPaths?: string[]
) {
  const self = globalThis.self as unknown as {
    onmessage: (event: { data: unknown }) => void;
  };
  self.onmessage({
    data: {
      taskId: 't',
      action: 'zipFiles',
      files: files.map((f) => new Blob([f.contents])),
      fileDetails: files.map((f) => ({ path: f.path })),
      folderPaths,
    },
  });
  await vi.waitFor(() => {
    expect(posted.some((m) => m.type === 'complete' || m.type === 'error')).toBe(
      true
    );
  });
  const done = posted.find((m) => m.type === 'complete');
  if (!done?.data.zipBlob) throw new Error(JSON.stringify(posted.at(-1)));
  return JSZip.loadAsync(done.data.zipBlob);
}

describe('zip worker', () => {
  it('writes nested office files under the dropped folder', async () => {
    const zip = await runZip(
      [
        { path: 'Pack/Summary.docx', contents: 'docx' },
        { path: 'Pack/Finance/Forecasts/Q4.xlsx', contents: 'xlsx' },
        { path: 'Pack/Decks/Old.PPTX', contents: 'pptx' },
      ],
      ['Pack', 'Pack/Finance', 'Pack/Finance/Forecasts', 'Pack/Decks']
    );

    expect(await zip.file('Pack/Finance/Forecasts/Q4.xlsx')?.async('string')).toBe(
      'xlsx'
    );
    expect(await zip.file('Pack/Decks/Old.PPTX')?.async('string')).toBe('pptx');
  });

  it('keeps empty folders as directory entries', async () => {
    const zip = await runZip(
      [{ path: 'Pack/a.docx', contents: 'a' }],
      ['Pack', 'Pack/Empty', 'Pack/Nested/Empty Leaf']
    );

    const folders = Object.values(zip.files)
      .filter((entry) => entry.dir)
      .map((entry) => entry.name)
      .sort();
    expect(folders).toEqual([
      'Pack/',
      'Pack/Empty/',
      'Pack/Nested/',
      'Pack/Nested/Empty Leaf/',
    ]);
  });

  it('zips a folder that has no files', async () => {
    const zip = await runZip([], ['Shell', 'Shell/A']);

    expect(Object.keys(zip.files).sort()).toEqual(['Shell/', 'Shell/A/']);
  });

  it('accepts messages without folder paths', async () => {
    const zip = await runZip([{ path: 'Pack/a.docx', contents: 'a' }]);

    expect(zip.file('Pack/a.docx')).not.toBeNull();
  });
});

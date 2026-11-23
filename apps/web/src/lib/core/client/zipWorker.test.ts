// @vitest-environment node
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import {
  installZipWorker,
  type ZipWorkerPort,
  type ZipWorkerRequest,
  type ZipWorkerResponse,
} from '../../workers/folder-upload/zip-worker';

async function runZip(
  files: { path: string; contents: string }[],
  folderPaths?: string[]
) {
  const posted: ZipWorkerResponse[] = [];
  const port: ZipWorkerPort = {
    postMessage: (message) => posted.push(message),
    onmessage: null,
  };
  installZipWorker(port);

  const request: ZipWorkerRequest = {
    taskId: 't',
    action: 'zipFiles',
    files: files.map((f) => new File([f.contents], f.path)),
    fileDetails: files.map((f) => ({ path: f.path })),
    folderPaths,
  };
  port.onmessage?.({ data: request } as MessageEvent<ZipWorkerRequest>);

  await vi.waitFor(() => {
    expect(
      posted.some((m) => m.type === 'complete' || m.type === 'error')
    ).toBe(true);
  });
  const done = posted.find((m) => m.type === 'complete');
  if (done?.type !== 'complete') throw new Error(JSON.stringify(posted.at(-1)));
  return unzipSync(new Uint8Array(await done.data.zipBlob.arrayBuffer()));
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

    expect(strFromU8(zip['Pack/Finance/Forecasts/Q4.xlsx'])).toBe('xlsx');
    expect(strFromU8(zip['Pack/Decks/Old.PPTX'])).toBe('pptx');
  });

  it('keeps empty folders as directory entries', async () => {
    const zip = await runZip(
      [{ path: 'Pack/a.docx', contents: 'a' }],
      ['Pack', 'Pack/Empty', 'Pack/Nested/Empty Leaf']
    );

    const folders = Object.keys(zip)
      .filter((name) => name.endsWith('/'))
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

    expect(Object.keys(zip).sort()).toEqual(['Shell/', 'Shell/A/']);
  });

  it('accepts messages without folder paths', async () => {
    const zip = await runZip([{ path: 'Pack/a.docx', contents: 'a' }]);

    expect(strFromU8(zip['Pack/a.docx'])).toBe('a');
  });
});

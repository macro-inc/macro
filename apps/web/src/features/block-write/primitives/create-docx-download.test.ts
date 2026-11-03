import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  downloadFile: vi.fn(async (_blob: Blob, _name: string) => ({ saved: true })),
  downloadExportedDocument: vi.fn(async () => new Uint8Array([9])),
}));
vi.mock('@filesystem/download', () => ({ downloadFile: mocks.downloadFile }));
vi.mock('@service-storage/util/downloadExportedDocument', () => ({
  downloadExportedDocument: mocks.downloadExportedDocument,
}));

import { createDocxDownload } from './create-docx-download';
import type { DocxEditor } from './create-docx-editor';

const savedBlob = () =>
  mocks.downloadFile.mock.calls.at(-1)?.[0] as unknown as Blob;

const setup = () =>
  createRoot(() =>
    createDocxDownload({
      documentId: 'doc-1',
      fileName: () => 'Plan.docx',
      onError: vi.fn(),
    })
  );

describe('createDocxDownload', () => {
  it('saves the mounted editor once its edits have synced', async () => {
    const order: string[] = [];
    const editor = {
      idle: async () => {
        order.push('idle');
      },
      save: async () => {
        order.push('save');
        return new Uint8Array([1, 2]);
      },
    } as unknown as DocxEditor;
    const download = setup();
    download.setEditor(editor);

    await download.download();

    expect(order).toEqual(['idle', 'save']);
    expect(mocks.downloadExportedDocument).not.toHaveBeenCalled();
    expect(savedBlob().size).toBe(2);
    expect(savedBlob().type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    expect(mocks.downloadFile.mock.calls.at(-1)?.[1]).toBe('Plan.docx');
  });

  it("falls back to the server's export before the editor mounts", async () => {
    const download = setup();

    await download.download();

    expect(mocks.downloadExportedDocument).toHaveBeenCalledWith({
      documentId: 'doc-1',
    });
    expect(savedBlob().size).toBe(1);
  });

  it('reports a failed save instead of rejecting', async () => {
    const onError = vi.fn();
    const failure = new Error('save failed');
    const download = createRoot(() =>
      createDocxDownload({
        documentId: 'doc-1',
        fileName: () => 'Plan.docx',
        onError,
      })
    );
    download.setEditor({
      idle: async () => {},
      save: async () => {
        throw failure;
      },
    } as unknown as DocxEditor);

    await download.download();

    expect(onError).toHaveBeenCalledWith(failure);
  });
});

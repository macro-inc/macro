import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDraftAttachments,
  type DraftAttachmentsOptions,
  documentAttachmentFileName,
  PENDING_ATTACHMENT_NAME,
} from './draft-attachments';

const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

function setup(options: Partial<DraftAttachmentsOptions> = {}) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const onChange = vi.fn();
    const describe = vi.fn(
      options.describe ??
        (async (documentId: string) => ({
          fileName: `${documentId}.pdf`,
          mimeType: 'application/pdf',
        }))
    );
    const upload = vi.fn(
      options.upload ??
        (async (file: File) => ({ documentId: `doc-for-${file.name}` }))
    );
    const attachments = createDraftAttachments({
      initial: options.initial,
      describe,
      upload,
      onChange,
    });
    return { attachments, onChange, describe, upload };
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('documentAttachmentFileName', () => {
  it('appends the extension the send attaches with', () => {
    expect(documentAttachmentFileName('Q3 report', 'pdf')).toBe(
      'Q3 report.pdf'
    );
  });

  it('keeps a name that already ends with the extension', () => {
    expect(documentAttachmentFileName('photo.PNG', 'png')).toBe('photo.PNG');
  });

  it('falls back to a placeholder for a blank name', () => {
    expect(documentAttachmentFileName('   ', 'pdf')).toBe(
      `${PENDING_ATTACHMENT_NAME}.pdf`
    );
    expect(documentAttachmentFileName('', undefined)).toBe(
      PENDING_ATTACHMENT_NAME
    );
  });
});

describe('createDraftAttachments', () => {
  it('lists the agent-named documents at once and names them when metadata resolves', async () => {
    const { attachments, describe } = setup({
      initial: [{ documentId: 'a' }, { documentId: 'b' }],
    });

    expect(attachments.list()).toEqual([
      expect.objectContaining({
        type: 'document',
        documentId: 'a',
        fileName: PENDING_ATTACHMENT_NAME,
      }),
      expect.objectContaining({ type: 'document', documentId: 'b' }),
    ]);
    expect(attachments.toToolArgs()).toEqual([
      { documentId: 'a' },
      { documentId: 'b' },
    ]);

    await flush();
    expect(describe).toHaveBeenCalledTimes(2);
    expect(
      attachments
        .list()
        .map((a) => (a.type === 'document' ? a.fileName : undefined))
    ).toEqual(['a.pdf', 'b.pdf']);
  });

  it('keeps the placeholder when metadata cannot be read', async () => {
    const { attachments } = setup({
      initial: [{ documentId: 'gone' }],
      describe: async () => {
        throw new Error('404');
      },
    });
    await flush();
    expect(attachments.list()[0]).toMatchObject({
      type: 'document',
      fileName: PENDING_ATTACHMENT_NAME,
    });
    expect(attachments.toToolArgs()).toEqual([{ documentId: 'gone' }]);
  });

  it('shows a user-added file while it uploads, then carries it as a document', async () => {
    const { promise, resolve } = Promise.withResolvers<{
      documentId: string;
    }>();
    const { attachments, onChange } = setup({ upload: () => promise });
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });

    attachments.add([{ type: 'local', file }]);
    expect(attachments.uploading()).toBe(true);
    expect(attachments.list()).toEqual([{ type: 'local', file }]);
    expect(attachments.toToolArgs()).toEqual([]);

    resolve({ documentId: 'doc-1' });
    await flush();
    expect(attachments.uploading()).toBe(false);
    expect(attachments.list()).toEqual([
      {
        type: 'document',
        documentId: 'doc-1',
        fileName: 'notes.txt',
        mimeType: 'text/plain',
        fileSize: 1,
      },
    ]);
    expect(attachments.toToolArgs()).toEqual([{ documentId: 'doc-1' }]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('drops a file whose upload fails without touching the tool args', async () => {
    const { attachments, onChange } = setup({ upload: async () => undefined });
    attachments.add([{ type: 'local', file: new File(['x'], 'bad.bin') }]);
    await flush();
    expect(attachments.list()).toEqual([]);
    expect(attachments.uploading()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('forgets a file the user removed before its upload finished', async () => {
    const { promise, resolve } = Promise.withResolvers<{
      documentId: string;
    }>();
    const { attachments, onChange } = setup({ upload: () => promise });
    const file = new File(['x'], 'late.txt');
    attachments.add([{ type: 'local', file }]);
    attachments.remove({ type: 'local', file });
    expect(attachments.list()).toEqual([]);

    resolve({ documentId: 'doc-late' });
    await flush();
    expect(attachments.list()).toEqual([]);
    expect(attachments.toToolArgs()).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes a document and reports the change', () => {
    const { attachments, onChange } = setup({
      initial: [{ documentId: 'a' }, { documentId: 'b' }],
    });
    const [first] = attachments.list();
    attachments.remove(first!);
    expect(attachments.toToolArgs()).toEqual([{ documentId: 'b' }]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ignores remote and forwarded attachments, which only a saved draft has', () => {
    const { attachments, onChange } = setup({
      initial: [{ documentId: 'a' }],
    });
    attachments.add([
      {
        type: 'forwarded',
        attachmentId: 'f',
        fileName: 'f.pdf',
        mimeType: 'application/pdf',
        fileSize: 1,
      },
    ]);
    attachments.remove({
      type: 'remote',
      attachmentId: 'r',
      fileName: 'r.pdf',
      contentType: 'application/pdf',
      url: 'key',
      fileSize: 1,
    });
    expect(attachments.toToolArgs()).toEqual([{ documentId: 'a' }]);
    expect(onChange).not.toHaveBeenCalled();
  });
});

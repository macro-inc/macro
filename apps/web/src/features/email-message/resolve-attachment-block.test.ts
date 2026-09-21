import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFileTypeToBlockName = vi.fn((fileType?: string | null): string => {
  if (!fileType) return 'unknown';
  if (['ai', 'ps', 'eps', 'pdf'].includes(fileType)) return 'pdf';
  return 'unknown';
});

vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: (fileType?: string | null) =>
    mockFileTypeToBlockName(fileType),
}));

describe('resolveEmailAttachmentBlockName', () => {
  beforeEach(() => {
    mockFileTypeToBlockName.mockClear();
  });

  it('opens .ai attachments in the pdf viewer from the filename', async () => {
    const { resolveEmailAttachmentBlockName } = await import(
      './resolve-attachment-block'
    );
    expect(
      resolveEmailAttachmentBlockName({
        filename: 'logo.ai',
        mimeType: 'application/postscript',
        documentFileType: 'ps',
      })
    ).toBe('pdf');
    expect(mockFileTypeToBlockName).toHaveBeenCalledWith('ai');
  });

  it('opens documents stored as ps (legacy postscript mime mapping) in pdf', async () => {
    const { resolveEmailAttachmentBlockName } = await import(
      './resolve-attachment-block'
    );
    expect(
      resolveEmailAttachmentBlockName({
        documentFileType: 'ps',
      })
    ).toBe('pdf');
  });

  it('prefers filename over ambiguous MIME mappings', async () => {
    const { resolveEmailAttachmentBlockName } = await import(
      './resolve-attachment-block'
    );
    expect(
      resolveEmailAttachmentBlockName({
        filename: 'drawing.ai',
        mimeType: 'application/octet-stream',
      })
    ).toBe('pdf');
  });

  it('falls back to document file type when filename has no extension', async () => {
    const { resolveEmailAttachmentBlockName } = await import(
      './resolve-attachment-block'
    );
    expect(
      resolveEmailAttachmentBlockName({
        filename: 'logo',
        documentFileType: 'ai',
        mimeType: 'application/postscript',
      })
    ).toBe('pdf');
  });

  it('falls back to MIME when filename and document type are missing', async () => {
    const { resolveEmailAttachmentBlockName } = await import(
      './resolve-attachment-block'
    );
    expect(
      resolveEmailAttachmentBlockName({
        mimeType: 'application/pdf',
      })
    ).toBe('pdf');
  });

  it('returns unknown for unrecognized types', async () => {
    const { resolveEmailAttachmentBlockName } = await import(
      './resolve-attachment-block'
    );
    expect(
      resolveEmailAttachmentBlockName({
        filename: 'thing.zzz',
        mimeType: 'application/x-unknown',
      })
    ).toBe('unknown');
  });
});

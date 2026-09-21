import { describe, expect, it } from 'vitest';
import { resolveEmailAttachmentBlockName } from './resolve-attachment-block';

describe('resolveEmailAttachmentBlockName', () => {
  it('opens .ai attachments in the pdf viewer from the filename', () => {
    expect(
      resolveEmailAttachmentBlockName({
        filename: 'logo.ai',
        mimeType: 'application/postscript',
        documentFileType: 'ps',
      })
    ).toBe('pdf');
  });

  it('opens documents stored as ps (legacy postscript mime mapping) in pdf', () => {
    expect(
      resolveEmailAttachmentBlockName({
        documentFileType: 'ps',
      })
    ).toBe('pdf');
  });

  it('prefers filename over ambiguous MIME mappings', () => {
    expect(
      resolveEmailAttachmentBlockName({
        filename: 'drawing.ai',
        mimeType: 'application/octet-stream',
      })
    ).toBe('pdf');
  });

  it('falls back to document file type when filename has no extension', () => {
    expect(
      resolveEmailAttachmentBlockName({
        filename: 'logo',
        documentFileType: 'ai',
        mimeType: 'application/postscript',
      })
    ).toBe('pdf');
  });

  it('falls back to MIME when filename and document type are missing', () => {
    expect(
      resolveEmailAttachmentBlockName({
        mimeType: 'application/pdf',
      })
    ).toBe('pdf');
  });

  it('returns unknown for unrecognized types', () => {
    expect(
      resolveEmailAttachmentBlockName({
        filename: 'thing.zzz',
        mimeType: 'application/x-unknown',
      })
    ).toBe('unknown');
  });
});

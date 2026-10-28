import { describe, expect, it } from 'vitest';
import {
  attachmentLimitBytes,
  MAX_ATTACHMENTS_BYTES_SIZE,
} from '../core/constants';
import { partitionByAttachmentLimit } from './attachment-limit';

const MB = 1_000_000;

function fileOf(bytes: number, name: string) {
  return new File([new ArrayBuffer(bytes)], name);
}

describe('partitionByAttachmentLimit', () => {
  it('attaches the files that fit and sets the others aside in picking order', () => {
    const huge = fileOf(MAX_ATTACHMENTS_BYTES_SIZE + 1, 'huge.mov');
    const small = fileOf(2 * MB, 'small.pdf');
    expect(
      partitionByAttachmentLimit([huge, small], [], MAX_ATTACHMENTS_BYTES_SIZE)
    ).toEqual({
      attachable: [small],
      oversized: [huge],
    });
  });

  it('counts attachments already on the draft toward the limit', () => {
    const over = fileOf(3 * MB, 'over.pdf');
    const fits = fileOf(1 * MB, 'fits.pdf');
    expect(
      partitionByAttachmentLimit(
        [over, fits],
        [
          {
            type: 'remote',
            attachmentId: 'remote',
            url: 'https://example.com/file',
            fileName: 'remote.pdf',
            contentType: 'application/pdf',
            fileSize: 10 * MB,
          },
          { type: 'local', file: fileOf(6 * MB, 'local.pdf') },
        ],
        MAX_ATTACHMENTS_BYTES_SIZE
      )
    ).toEqual({ attachable: [fits], oversized: [over] });
  });

  it('fills the limit exactly and sets aside the next byte', () => {
    const half = fileOf(MAX_ATTACHMENTS_BYTES_SIZE / 2, 'half.zip');
    const rest = fileOf(MAX_ATTACHMENTS_BYTES_SIZE / 2, 'rest.zip');
    const extra = fileOf(1, 'extra.zip');
    expect(
      partitionByAttachmentLimit(
        [half, rest, extra],
        [],
        MAX_ATTACHMENTS_BYTES_SIZE
      )
    ).toEqual({ attachable: [half, rest], oversized: [extra] });
  });

  it('lets an Outlook inbox attach what Gmail cannot', () => {
    const large = fileOf(20 * MB, 'large.mov');
    expect(
      partitionByAttachmentLimit([large], [], attachmentLimitBytes('GMAIL'))
    ).toEqual({ attachable: [], oversized: [large] });
    expect(
      partitionByAttachmentLimit([large], [], attachmentLimitBytes('OUTLOOK'))
    ).toEqual({ attachable: [large], oversized: [] });
  });
});

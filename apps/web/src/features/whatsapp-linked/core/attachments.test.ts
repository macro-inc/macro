import { expect, it } from 'vitest';
import { attachmentProblem, captionOf, mediaKindOf } from './attachments';

const MB = 1024 * 1024;

it('sends only the file types WhatsApp groups accept', () => {
  expect(mediaKindOf('image/webp')).toBe('image');
  expect(mediaKindOf('audio/ogg')).toBe('audio');
  expect(mediaKindOf('video/mp4')).toBe('video');
  expect(mediaKindOf('text/plain')).toBe('document');
  expect(mediaKindOf('image/gif')).toBeUndefined();
});

it('explains a refused file by type, then by size', () => {
  expect(
    attachmentProblem({ name: 'a.gif', type: 'image/gif', size: 1 }, 32 * MB)
  ).toBe("WhatsApp doesn't accept a.gif's file type.");
  expect(
    attachmentProblem(
      { name: 'b.mp4', type: 'video/mp4', size: 33 * MB },
      32 * MB
    )
  ).toBe("b.mp4 is larger than WhatsApp's 32 MB limit.");
  expect(
    attachmentProblem(
      { name: 'c.pdf', type: 'application/pdf', size: MB },
      32 * MB
    )
  ).toBeUndefined();
});

it('keeps the person’s caption and drops DSS’s stand-in for the files', () => {
  const receipt = {
    ordinal: 0,
    state: 'unavailable' as const,
    fileName: 'receipt.jpg',
    documentId: undefined,
  };
  expect(captionOf('Loading attachment…', [receipt])).toBe('');
  expect(
    captionOf('Lunch was 12 euros\n\nAttachment unavailable: receipt.jpg', [
      receipt,
    ])
  ).toBe('Lunch was 12 euros');
  expect(captionOf('Attachment unavailable: other.pdf', [receipt])).toBe(
    'Attachment unavailable: other.pdf'
  );
});

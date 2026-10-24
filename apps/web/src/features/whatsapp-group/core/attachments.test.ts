import { expect, it } from 'vitest';
import { attachmentProblem } from './attachments';

const MB = 1024 * 1024;
const limits = {
  attachmentTypes: ['image/jpeg', 'video/mp4', 'application/pdf'],
  attachmentBytes: 32 * MB,
};

it('explains a refused file by type, then by size', () => {
  expect(
    attachmentProblem({ name: 'a.gif', type: 'image/gif', size: 1 }, limits)
  ).toBe("WhatsApp doesn't accept a.gif's file type.");
  expect(
    attachmentProblem(
      { name: 'b.mp4', type: 'video/mp4', size: 33 * MB },
      limits
    )
  ).toBe("b.mp4 is larger than WhatsApp's 32 MB limit.");
  expect(
    attachmentProblem(
      { name: 'c.pdf', type: 'application/pdf', size: MB },
      limits
    )
  ).toBeUndefined();
});

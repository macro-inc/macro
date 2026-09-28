/**
 * The composer's prompt action: what the draft and its chips become on the
 * wire. This is the contract `create-composer-controller.test.ts` covered
 * before #6518 moved sending onto the session's `issue`.
 */

import { describe, expect, it } from 'vitest';
import { promptActionOf } from './prompt-action';

const uploaded = {
  id: 'file-1',
  name: 'screenshot.png',
  kind: 'image' as const,
  mimeType: 'image/png',
  size: 2048,
};

describe('the prompt action', () => {
  it('carries the attached files alongside the text', () => {
    expect(promptActionOf('look', [uploaded])).toEqual({
      type: 'prompt',
      prompt: 'look',
      attachments: [
        {
          uri: expect.stringContaining('file-1'),
          name: 'screenshot.png',
          mimeType: 'image/png',
          size: 2048,
        },
      ],
    });
  });

  it('omits the field entirely when nothing is attached', () => {
    expect(promptActionOf('look', [])).toEqual({
      type: 'prompt',
      prompt: 'look',
    });
  });

  it('leaves out a file that is still uploading', () => {
    expect(promptActionOf('look', [{ ...uploaded, pending: true }])).toEqual({
      type: 'prompt',
      prompt: 'look',
    });
  });

  it('sends attachments with no text at all', () => {
    const action = promptActionOf('', [uploaded]);
    expect(action).toMatchObject({ type: 'prompt', prompt: '' });
    expect(
      'attachments' in action ? action.attachments : undefined
    ).toHaveLength(1);
  });
});

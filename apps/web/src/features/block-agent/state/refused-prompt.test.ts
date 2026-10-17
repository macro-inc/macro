import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import { refusedPromptAction } from './refused-prompt';

const message = (
  turn: number,
  author: 'user' | 'agent',
  parts: FoldedMessage['parts']
): FoldedMessage =>
  ({
    turn,
    author:
      author === 'user' ? { kind: 'user', userId: null } : { kind: 'agent' },
    parts,
    stop: null,
  }) as unknown as FoldedMessage;

describe('refusedPromptAction', () => {
  it('repeats the refused turn’s own text and attachments', () => {
    const messages = [
      message(1, 'user', [{ kind: 'text', text: 'earlier' }]),
      message(2, 'user', [
        { kind: 'text', text: 'summarize ' },
        { kind: 'text', text: 'this' },
        {
          kind: 'attachment',
          uri: 'https://static.example/file.pdf',
          name: 'file.pdf',
          mimeType: 'application/pdf',
          size: 10,
        },
      ]),
      message(2, 'agent', []),
    ];

    expect(refusedPromptAction(messages, 2)).toEqual({
      type: 'prompt',
      prompt: 'summarize this',
      attachments: [
        {
          uri: 'https://static.example/file.pdf',
          name: 'file.pdf',
          mimeType: 'application/pdf',
          size: 10,
        },
      ],
    });
  });

  it('has nothing to repeat for a turn without a prompt', () => {
    expect(refusedPromptAction([message(3, 'agent', [])], 3)).toBeUndefined();
  });
});

/**
 * @vitest-environment jsdom
 */

import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import { foldedMessageQuoteText, selectedTextIn } from './quote-reply';

function message(
  parts: FoldedMessage['parts'],
  author: FoldedMessage['author'] = { kind: 'agent' }
): FoldedMessage {
  return {
    agentSessionId: 'session',
    requestId: null,
    turn: 0,
    author,
    parts,
    stop: { kind: 'end_turn' },
  };
}

describe('foldedMessageQuoteText', () => {
  it('joins text parts and ignores tools', () => {
    expect(
      foldedMessageQuoteText(
        message([
          { kind: 'text', text: 'first' },
          {
            kind: 'tool_use',
            id: 't',
            label: 'Read',
            status: 'completed',
            detail: { kind: 'read', paths: ['a.ts'] },
          },
          { kind: 'text', text: 'second' },
        ])
      )
    ).toBe('first\n\nsecond');
  });

  it('falls back to thoughts when there is no prose', () => {
    expect(
      foldedMessageQuoteText(
        message([{ kind: 'thought', text: 'maybe this path' }])
      )
    ).toBe('maybe this path');
  });

  it('prefers prose over thoughts', () => {
    expect(
      foldedMessageQuoteText(
        message([
          { kind: 'thought', text: 'hidden' },
          { kind: 'text', text: 'visible' },
        ])
      )
    ).toBe('visible');
  });

  it('returns empty when there is nothing to quote', () => {
    expect(
      foldedMessageQuoteText(
        message([
          {
            kind: 'tool_use',
            id: 't',
            label: 'Read',
            status: 'completed',
            detail: { kind: 'read', paths: ['a.ts'] },
          },
        ])
      )
    ).toBe('');
  });
});

describe('selectedTextIn', () => {
  it('returns the highlighted text when it lives inside the root', () => {
    const root = document.createElement('div');
    root.append('hello world');
    document.body.append(root);
    const range = document.createRange();
    range.selectNodeContents(root);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(selectedTextIn(root)).toBe('hello world');

    selection?.removeAllRanges();
    root.remove();
  });

  it('ignores a selection that is outside the root', () => {
    const root = document.createElement('div');
    root.append('inside');
    const other = document.createElement('div');
    other.append('outside');
    document.body.append(root, other);
    const range = document.createRange();
    range.selectNodeContents(other);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(selectedTextIn(root)).toBeUndefined();

    selection?.removeAllRanges();
    root.remove();
    other.remove();
  });
});

import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import { isContextOnlyMessage } from './context-message';

const completion: FoldedMessage = {
  agentSessionId: 'session',
  turn: 1,
  author: { kind: 'user', userId: 'macro|me@macro.com' },
  requestId: null,
  parts: [
    {
      kind: 'text',
      text: '<m-agent-context>{"version":1,"text":"One reviewed email was sent."}</m-agent-context>',
    },
  ],
  stop: null,
  pending: false,
  segments: [],
  phase: null,
  postedAt: '2026-10-16T20:00:00Z',
};

describe('isContextOnlyMessage', () => {
  it('recognizes a private review outcome with no visible prompt', () => {
    expect(isContextOnlyMessage(completion)).toBe(true);
    expect(
      isContextOnlyMessage({
        ...completion,
        parts: [...completion.parts, { kind: 'text', text: '\n  ' }],
      })
    ).toBe(true);
  });

  it('preserves a normal prompt alongside private context', () => {
    expect(
      isContextOnlyMessage({
        ...completion,
        parts: [
          ...completion.parts,
          { kind: 'text', text: 'Send the next email.' },
        ],
      })
    ).toBe(false);
  });

  it('preserves attachments even when the text is all private context', () => {
    expect(
      isContextOnlyMessage({
        ...completion,
        parts: [
          ...completion.parts,
          {
            kind: 'attachment',
            uri: 'https://example.invalid/attachment.pdf',
            name: 'Attachment.pdf',
            mimeType: 'application/pdf',
            size: 100,
          },
        ],
      })
    ).toBe(false);
  });

  it('does not hide agent messages or ordinary empty user messages', () => {
    expect(
      isContextOnlyMessage({ ...completion, author: { kind: 'agent' } })
    ).toBe(false);
    expect(isContextOnlyMessage({ ...completion, parts: [] })).toBe(false);
    expect(
      isContextOnlyMessage({
        ...completion,
        parts: [{ kind: 'text', text: '' }],
      })
    ).toBe(false);
  });

  it('leaves malformed, unsupported, and quoted context visible', () => {
    for (const text of [
      '<m-agent-context>not JSON</m-agent-context>',
      '<m-agent-context>{"version":2,"text":"private"}</m-agent-context>',
      '<m-agent-context>{"version":1,"text":"private"}',
      '&lt;m-agent-context>{"version":1,"text":"example"}&lt;/m-agent-context>',
    ]) {
      expect(
        isContextOnlyMessage({ ...completion, parts: [{ kind: 'text', text }] })
      ).toBe(false);
    }
  });
});

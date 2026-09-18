import { describe, expect, it } from 'vitest';
import { transcriptTarget } from './runTranscript';

describe('transcriptTarget', () => {
  it('opens a legacy chat in the chat split', () => {
    expect(
      transcriptTarget({ kind: 'legacy_chat', id: 'b7e3c0a2-chat' })
    ).toEqual({ type: 'chat', id: 'b7e3c0a2-chat' });
  });

  it('opens an agent session in the agent split', () => {
    expect(
      transcriptTarget({
        kind: 'agent_session',
        id: '019254d0-0000-7000-8000-000000000001',
      })
    ).toEqual({ type: 'agent', id: '019254d0-0000-7000-8000-000000000001' });
  });

  it('leaves a run that produced nothing without a target', () => {
    const history = [
      null,
      { kind: 'agent_session' as const, id: 'session-1' },
      undefined,
      { kind: 'legacy_chat' as const, id: 'chat-1' },
    ];

    expect(history.map(transcriptTarget)).toEqual([
      undefined,
      { type: 'agent', id: 'session-1' },
      undefined,
      { type: 'chat', id: 'chat-1' },
    ]);
  });
});

import type {
  FoldedMessage,
  MessagePart,
  Segment,
} from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import {
  openReply,
  replyToTurn,
  segmentRows,
  streamingProse,
  typingLabel,
} from './live-reply';

function reply(
  turn: number,
  parts: MessagePart[],
  segments: Segment[],
  closed = false
): FoldedMessage {
  return {
    agentSessionId: 'session',
    turn,
    author: { kind: 'agent' },
    requestId: null,
    parts,
    stop: closed ? { kind: 'end_turn' } : null,
    pending: false,
    segments,
    phase: closed ? null : 'writing',
  };
}

const prose = (index: number, start: number, sealed: boolean): Segment => ({
  index,
  kind: 'prose',
  start,
  end: start + 1,
  sealed,
  rows: [],
});

describe('live reply', () => {
  it('finds the reply still being written, not an earlier finished one', () => {
    const done = reply(
      0,
      [{ kind: 'text', text: 'Done' }],
      [prose(0, 0, true)],
      true
    );
    const running = reply(
      1,
      [{ kind: 'text', text: 'Hi' }],
      [prose(0, 0, false)]
    );
    expect(openReply([done, running])?.turn).toBe(1);
    expect(openReply([done])).toBeUndefined();
    expect(replyToTurn([done, running], 0)).toBe(done);
  });

  it('streams only an unfinished passage', () => {
    const writing = reply(
      0,
      [
        { kind: 'text', text: 'Posted already.' },
        {
          kind: 'tool_use',
          id: 't1',
          name: { kind: 'native', name: 'Bash' },
          status: 'completed',
          detail: {
            kind: 'terminal',
            command: 'ls',
            output: null,
            exitCode: 0,
          },
        },
        { kind: 'text', text: 'Still writing' },
      ],
      [
        prose(0, 0, true),
        {
          index: 1,
          kind: 'activity',
          start: 1,
          end: 2,
          sealed: true,
          rows: [{ id: 't1', label: 'Ran', detail: 'ls', status: 'completed' }],
        },
        prose(2, 2, false),
      ]
    );
    expect(streamingProse(writing)).toBe('Still writing');
    expect(segmentRows(writing, 1)).toEqual([
      { id: 't1', label: 'Ran', detail: 'ls', status: 'completed' },
    ]);
    expect(segmentRows(writing, 0)).toBeUndefined();
    const finished = reply(
      0,
      [{ kind: 'text', text: 'All done' }],
      [prose(0, 0, true)]
    );
    expect(streamingProse(finished)).toBeUndefined();
  });

  it('says what the agent is doing in words', () => {
    expect(typingLabel('Macro', 'writing')).toBe('Macro is typing');
    expect(typingLabel('Scout', 'working')).toBe('Scout is working');
    expect(typingLabel('Scout', 'waiting')).toBe(
      'Scout is waiting for an answer'
    );
  });
});

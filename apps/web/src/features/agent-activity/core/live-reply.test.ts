import type {
  FoldedMessage,
  MessagePart,
  Segment,
} from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import {
  openReply,
  openRun,
  phaseRow,
  replyToTurn,
  segmentRows,
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
    postedAt: null,
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

  it('finds the run the agent is in the middle of, and no finished one', () => {
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
    expect(openRun(writing)).toBeUndefined();
    expect(segmentRows(writing, 1)).toEqual([
      { id: 't1', label: 'Ran', detail: 'ls', status: 'completed' },
    ]);
    expect(segmentRows(writing, 0)).toBeUndefined();
    const finished = reply(
      0,
      [{ kind: 'text', text: 'All done' }],
      [prose(0, 0, true)]
    );
    expect(openRun(finished)).toBeUndefined();
    const working = reply(
      0,
      [],
      [
        prose(0, 0, true),
        {
          index: 1,
          kind: 'activity',
          start: 1,
          end: 2,
          sealed: false,
          rows: [],
        },
      ]
    );
    expect(openRun(working)?.index).toBe(1);
    expect(openRun(undefined)).toBeUndefined();
  });

  it('says what the turn is doing in words', () => {
    expect(phaseRow('thinking').label).toBe('Thinking');
    expect(phaseRow('writing').label).toBe('Writing');
    expect(phaseRow('working').label).toBe('Working');
    expect(phaseRow('waiting').label).toBe('Waiting for an answer');
  });
});

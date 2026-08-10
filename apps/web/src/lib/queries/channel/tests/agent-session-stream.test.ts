import type { AgentSessionLogEvent } from '@core/agent-fold/stream-protocol';
import type { AgentSessionLogEntryDto } from '@service-storage/generated/schemas/agentSessionLogEntryDto';
import { describe, expect, it } from 'vitest';
import {
  dropOverlap,
  handleAgentSessionLog,
  subscribeAgentSessionLog,
} from '../agent-session-stream';

/**
 * A frame, distinguishable by `n`. The fold never sees these — only their
 * serialized form matters here.
 */
function frame(n: number): AgentSessionLogEntryDto {
  return {
    direction: 'to_server',
    content: { type: 'acp', jsonrpc: '2.0', id: n },
  } as unknown as AgentSessionLogEntryDto;
}

const log = Array.from({ length: 10 }, (_, n) => frame(n));

describe('aligning a buffer against a fetched log', () => {
  it('replays everything when the buffer starts after the snapshot ends', () => {
    // The ordinary case: nothing arrived while the fetch was in flight.
    const fetched = log.slice(0, 6);
    const buffered = log.slice(6);
    expect(dropOverlap(fetched, buffered)).toEqual(buffered);
  });

  it('drops the frames the snapshot already contains', () => {
    // The fetch returned frames 0..7 while 5..9 were streaming in; 5, 6 and 7
    // are in both and must be folded once.
    const fetched = log.slice(0, 8);
    const buffered = log.slice(5);
    expect(dropOverlap(fetched, buffered)).toEqual(log.slice(8));
  });

  it('drops the whole buffer when the snapshot overtook it', () => {
    const fetched = log;
    const buffered = log.slice(4);
    expect(dropOverlap(fetched, buffered)).toEqual([]);
  });

  it('leaves a buffer that shares nothing with the snapshot alone', () => {
    expect(dropOverlap(log.slice(0, 4), [frame(99)])).toEqual([frame(99)]);
  });

  it('prefers the longest alignment when a frame repeats verbatim', () => {
    // A session can emit the same chunk twice running, which makes the true
    // alignment unknowable. Dropping costs a redraw; folding twice corrupts
    // the message, so the longer match wins.
    const fetched = [frame(1), frame(2), frame(2)];
    expect(dropOverlap(fetched, [frame(2), frame(2)])).toEqual([]);
  });

  it('holds nothing back when there is nothing buffered', () => {
    expect(dropOverlap(log, [])).toEqual([]);
  });
});

describe('observing raw session log frames', () => {
  it('delivers matching frames until unsubscribed', () => {
    const received: AgentSessionLogEvent[] = [];
    const first = {
      channelId: 'channel-1',
      agentSessionId: 'session-1',
      ...frame(1),
    } as AgentSessionLogEvent;
    const second = {
      channelId: 'channel-1',
      agentSessionId: 'session-1',
      ...frame(2),
    } as AgentSessionLogEvent;
    const unsubscribe = subscribeAgentSessionLog('session-1', (event) => {
      received.push(event);
    });

    handleAgentSessionLog(first);
    unsubscribe();
    handleAgentSessionLog(second);

    expect(received).toEqual([first]);
  });
});

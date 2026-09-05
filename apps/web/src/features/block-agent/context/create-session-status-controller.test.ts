import type { AgentSessionLogEntryDto } from '@service-agent-harness/generated/schemas';
import { describe, expect, it } from 'vitest';
import {
  isDisconnected,
  statusFromEntry,
} from './create-session-status-controller';

function entry(content: unknown): AgentSessionLogEntryDto {
  return { direction: 'to_server', content } as AgentSessionLogEntryDto;
}

describe('statusFromEntry', () => {
  it('projects a system-event frame into an event status', () => {
    expect(entryStatus({ type: 'event', event: 'acp_ready' })).toEqual({
      kind: 'event',
      event: 'acp_ready',
    });
  });

  it('ignores ACP frames', () => {
    expect(
      entryStatus({ type: 'acp', jsonrpc: '2.0', method: 'session/update' })
    ).toBeUndefined();
  });

  it('ignores malformed event frames', () => {
    expect(entryStatus({ type: 'event' })).toBeUndefined();
    expect(entryStatus({ type: 'event', event: 7 })).toBeUndefined();
  });

  function entryStatus(content: unknown) {
    return statusFromEntry(entry(content));
  }
});

describe('isDisconnected', () => {
  // The bug this closes: a live disconnect arrives as an *event*, never as
  // the snapshot's own kind, so checking only the latter missed every
  // disconnect that happened while the block was open.
  it('recognises the live event, not just the snapshot kind', () => {
    expect(isDisconnected({ kind: 'disconnected' })).toBe(true);
    expect(isDisconnected({ kind: 'event', event: 'disconnected' })).toBe(true);
  });

  it('leaves every other status alone', () => {
    expect(isDisconnected({ kind: 'no_messages' })).toBe(false);
    expect(isDisconnected({ kind: 'event', event: 'acp_ready' })).toBe(false);
  });
});

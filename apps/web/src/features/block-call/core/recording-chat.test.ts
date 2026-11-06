import { describe, expect, it } from 'vitest';
import { messageVideoSeconds, recordingChatMessages } from './recording-chat';

describe('recording chat timeline', () => {
  it('orders real messages, excluding call roots and deleted messages', () => {
    const root = {
      id: 'root',
      kind: 'call_root',
      created_at: '2026-01-01T00:00:00Z',
    };
    const first = { id: 'first', created_at: '2026-01-01T00:00:10Z' };
    const second = { id: 'second', created_at: '2026-01-01T00:00:20Z' };
    const deleted = {
      id: 'deleted',
      created_at: '2026-01-01T00:00:15Z',
      deleted_at: '2026-01-01T00:01:00Z',
    };
    expect(
      recordingChatMessages({ root, replies: [second, deleted, first] })
    ).toEqual([first, second]);
    expect(recordingChatMessages({ root: first, replies: [second] })).toEqual([
      first,
      second,
    ]);
  });
  it('anchors jump offsets to recording start and omits unavailable times', () => {
    const start = Date.parse('2026-01-01T00:00:05Z');
    expect(messageVideoSeconds('2026-01-01T00:00:15Z', start)).toBe(10);
    expect(messageVideoSeconds('2026-01-01T00:00:00Z', start)).toBeNull();
    expect(messageVideoSeconds('invalid', start)).toBeNull();
    expect(messageVideoSeconds('2026-01-01T00:00:15Z', null)).toBeNull();
  });
});

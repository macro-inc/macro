import { describe, expect, it } from 'vitest';
import { type ConversationTurnState, canResumeFrom } from './resume-from-reply';

// Message ids are UUIDv7: their leading digits are the time they were made.
const mondayReply = {
  messageId: '01a10b82-6f60-7000-8000-000000000001',
  postedAt: '2026-10-05T10:01:00Z',
};
const asked = (
  createdAt: string,
  replyMessageId: string | null,
  state = 'succeeded'
): ConversationTurnState => ({ state, createdAt, replyMessageId });
const monday = asked('2026-10-05T10:00:00Z', mondayReply.messageId);

describe('resuming the agent from a reply', () => {
  it('carries on from the reply that answered the latest request', () => {
    expect(canResumeFrom(mondayReply, [monday])).toBe(true);
    // The reply's last recorded message can be an earlier one of its own.
    expect(
      canResumeFrom(mondayReply, [
        asked('2026-10-05T10:00:00Z', '01a10b81-8118-7000-8000-000000000001'),
      ])
    ).toBe(true);
  });

  it('does not carry on from a reply older than the latest request', () => {
    const wednesday = asked(
      '2026-10-07T09:00:00Z',
      '01a11598-38e0-7000-8000-000000000001'
    );
    expect(canResumeFrom(mondayReply, [monday, wednesday])).toBe(false);
  });

  it('does not carry on from a reply that a later reply followed', () => {
    // Asked while the first request still ran, answered after its reply.
    const followUp = asked(
      '2026-10-05T10:00:30Z',
      '01a10b83-59c0-7000-8000-000000000001'
    );
    expect(canResumeFrom(mondayReply, [monday, followUp])).toBe(false);
  });

  it('does not carry on while the agent is working or a message waits', () => {
    for (const state of ['running', 'queued']) {
      expect(
        canResumeFrom(mondayReply, [
          asked('2026-10-05T10:00:00Z', mondayReply.messageId, state),
        ])
      ).toBe(false);
    }
  });

  it('does not carry on when it cannot tell when the reply was posted', () => {
    expect(
      canResumeFrom({ ...mondayReply, postedAt: 'not a time' }, [monday])
    ).toBe(false);
  });
});

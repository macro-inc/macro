import { describe, expect, it } from 'vitest';
import {
  connectEmailParticipants,
  type EmailThreadSummary,
} from './email-network';

const viewer = 'macro|me@example.com';
const teammate = 'macro|jackson@example.com';
const incoming: EmailThreadSummary = {
  id: 'thread',
  ownerId: viewer,
  participants: [{ email: 'older@example.com', name: 'Earlier participant' }],
  latestInboundAt: '2026-09-01T12:00:00Z',
  recentMessages: [],
  latest: {
    isSent: false,
    from: { email: 'sender@example.com', name: 'Sender' },
    to: [
      { email: 'ME@example.com' },
      { email: 'Jackson@Example.com', name: 'Jackson' },
    ],
    cc: [
      { email: 'alias@example.com' },
      { email: 'outside@example.com', name: 'Jackson' },
    ],
  },
};
const connect = (thread: EmailThreadSummary) =>
  connectEmailParticipants(
    thread,
    viewer,
    ['alias@example.com'],
    [viewer, teammate]
  );

describe('email participants and reply state', () => {
  it('recognizes a teammate reply even after an external acknowledgment', () => {
    const result = connect({
      ...incoming,
      recentMessages: [
        {
          isSent: false,
          isDraft: false,
          from: { email: 'sender@example.com' },
        },
        {
          isSent: false,
          isDraft: false,
          from: { email: 'jackson@example.com', name: 'Jackson' },
        },
        {
          isSent: false,
          isDraft: false,
          from: { email: 'sender@example.com' },
        },
      ],
    });
    expect(result.replyState).toBe('team-replied');
    expect(result.replyBy).toEqual({ id: teammate, name: 'Jackson' });
    expect(result.people.find((person) => person.id === teammate)?.role).toBe(
      'replied'
    );
  });

  it('recognizes a reply to an internal teammate without an inbound timestamp', () => {
    expect(
      connect({
        ...incoming,
        latestInboundAt: null,
        latest: { ...incoming.latest!, isSent: true },
        recentMessages: [
          { isSent: true, isDraft: false, from: { email: 'me@example.com' } },
          {
            isSent: false,
            isDraft: false,
            from: { email: 'jackson@example.com' },
          },
        ],
      }).replyState
    ).toBe('replied');
  });

  it('preserves a personal reply when a later incoming message arrives', () => {
    expect(
      connect({
        ...incoming,
        recentMessages: [
          {
            isSent: false,
            isDraft: false,
            from: { email: 'sender@example.com' },
          },
          { isSent: true, isDraft: false, from: { email: 'me@example.com' } },
          {
            isSent: false,
            isDraft: false,
            from: { email: 'sender@example.com' },
          },
        ],
      }).replyState
    ).toBe('replied');
  });

  it('ignores drafts and does not claim no reply when history is truncated', () => {
    const draft = {
      isSent: true,
      isDraft: true,
      from: { email: 'me@example.com' },
    };
    const received = {
      isSent: false,
      isDraft: false,
      from: { email: 'sender@example.com' },
    };
    expect(
      connect({ ...incoming, recentMessages: [draft, received] }).replyState
    ).toBe('unanswered');
    expect(
      connect({
        ...incoming,
        recentMessages: Array.from({ length: 12 }, () => received),
      }).replyState
    ).toBe('received');
  });

  it('matches exact teammate emails, omits owned aliases, and preserves external contacts', () => {
    const result = connect(incoming);
    expect(result.people.map(({ id, role }) => ({ id, role }))).toEqual([
      { id: 'contact:sender@example.com', role: 'sent' },
      { id: teammate, role: 'received' },
      { id: 'contact:outside@example.com', role: "cc'd" },
      { id: 'contact:older@example.com', role: 'on thread' },
    ]);
    expect(result.replyState).toBe('unanswered');
  });

  it('deduplicates case-insensitive addresses and prefers the latest name, retaining older photos', () => {
    const result = connect({
      ...incoming,
      participants: [
        {
          email: 'SENDER@example.com',
          name: 'Old name',
          picture: '/sender.png',
        },
      ],
    });
    expect(
      result.people.filter((p) => p.email === 'sender@example.com')
    ).toEqual([
      {
        id: 'contact:sender@example.com',
        email: 'sender@example.com',
        name: 'Sender',
        picture: '/sender.png',
        role: 'sent',
      },
    ]);
  });

  it('marks a sent message after an inbound message as replied', () => {
    expect(
      connect({ ...incoming, latest: { ...incoming.latest!, isSent: true } })
        .replyState
    ).toBe('replied');
  });

  it('recognizes replies sent from an owned alias even without a sent flag', () => {
    expect(
      connect({
        ...incoming,
        latest: { ...incoming.latest!, from: { email: 'ALIAS@example.com' } },
      }).replyState
    ).toBe('replied');
  });

  it('distinguishes an initial outbound email from a reply', () => {
    const outbound = {
      ...incoming,
      latestInboundAt: null,
      latest: { ...incoming.latest!, isSent: true },
    };
    expect(connect(outbound).replyState).toBe('sent');
    expect(
      connect({
        ...outbound,
        latest: { ...outbound.latest, replyingToId: 'earlier-message' },
      }).replyState
    ).toBe('replied');
  });

  it('does not claim the viewer replied in someone else’s inbox or without a content message', () => {
    expect(connect({ ...incoming, ownerId: teammate }).replyState).toBe(
      'unknown'
    );
    expect(connect({ ...incoming, latest: null }).replyState).toBe('unknown');
  });
});

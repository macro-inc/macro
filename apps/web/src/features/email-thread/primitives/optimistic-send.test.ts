import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { OutgoingEmail } from '../../email-compose/context/compose-capabilities';
import { createComposeContext } from '../../email-compose/tests/capabilities';
import { createThreadContext, message, thread } from '../tests/fixtures';
import { createOptimisticThreadSend } from './optimistic-send';

const outgoing: OutgoingEmail = {
  sendAttemptId: 'attempt',
  messageIds: ['draft'],
  threadIds: ['thread'],
  inboxId: 'inbox',
  delivered: false,
  message: {
    subject: 'Final subject',
    body_text: 'café',
    body_html_sanitized: '<p>café</p>',
    to: [{ email: 'recipient@example.com' }],
    cc: [],
    bcc: [],
  },
};

function setup() {
  return createRoot((dispose) => {
    const draft = message('draft', {
      is_draft: true,
      body_text: 'Older body',
      body_replyless: 'Older reply',
      labels: [{ provider_label_id: 'DRAFT' }],
      attachments_draft: [
        {
          id: 'file',
          s3_key: 'file',
          file_name: 'Notes.txt',
          content_type: 'text/plain',
          size: 20,
        },
      ],
    });
    const [snapshot, setSnapshot] = createSignal(
      thread([message('received'), draft])
    );
    const [sends, setSends] = createSignal<OutgoingEmail[]>([]);
    const refresh = vi.fn(async () => {});
    const compose = createComposeContext();
    compose.delivery.outgoing = sends;
    const source = createOptimisticThreadSend(
      createThreadContext({ thread: snapshot, refresh }).source,
      compose
    );
    return { source, snapshot, setSnapshot, setSends, refresh, dispose };
  });
}

it('shows an approved send in place of its draft until the thread read shows it', () => {
  const state = setup();
  try {
    state.setSends([outgoing]);
    expect(
      state.source.thread()?.messages.map((message) => message.db_id)
    ).toEqual(['received', 'draft']);
    expect(state.source.thread()?.messages[1]).toMatchObject({
      is_draft: false,
      subject: 'Final subject',
      body_text: 'café',
      body_html_sanitized: '<p>café</p>',
      body_replyless: null,
      from: { email: 'me@example.com' },
      to: [{ email: 'recipient@example.com' }],
      labels: [],
      attachments_draft: [{ id: 'file' }],
      sent_at: expect.any(String),
    });
    // The projection never changes the underlying draft snapshot.
    expect(state.snapshot().messages[1].is_draft).toBe(true);
    state.setSnapshot(
      thread([
        message('received'),
        message('draft', { body_text: 'Server body' }),
      ])
    );
    expect(
      state.source.thread()?.messages.map((message) => message.body_text)
    ).toEqual([undefined, 'Server body']);
    // A later deletion must not resurrect the confirmed send.
    state.setSnapshot(thread([message('received')]));
    expect(state.source.thread()?.messages).toHaveLength(1);
  } finally {
    state.dispose();
  }
});

it('shows a send from a new thread that the read has no draft for', () => {
  const state = setup();
  try {
    state.setSnapshot(thread([]));
    state.setSends([outgoing]);
    expect(state.source.thread()?.messages).toMatchObject([
      { db_id: 'draft', thread_db_id: 'thread', is_draft: false },
    ]);
  } finally {
    state.dispose();
  }
});

it('returns the draft and reads the thread again when the send is cancelled or fails', () => {
  const state = setup();
  try {
    state.setSends([outgoing]);
    expect(state.source.thread()?.messages[1].is_draft).toBe(false);
    state.setSends([]);
    expect(state.source.thread()?.messages[1]).toMatchObject({
      is_draft: true,
      body_text: 'Older body',
    });
    // Admission already made the server's copy a sent message.
    expect(state.refresh).toHaveBeenCalledOnce();
  } finally {
    state.dispose();
  }
});

it('keeps a delivered send after it leaves the outbox and reads the thread once', () => {
  const state = setup();
  try {
    state.setSends([outgoing]);
    expect(state.refresh).not.toHaveBeenCalled();
    state.setSends([{ ...outgoing, delivered: true }]);
    expect(state.refresh).toHaveBeenCalledOnce();
    state.setSends([]);
    expect(state.source.thread()?.messages[1].is_draft).toBe(false);
    expect(state.refresh).toHaveBeenCalledOnce();
  } finally {
    state.dispose();
  }
});

it('reads the thread again when a send the read already shows is undone', () => {
  const state = setup();
  try {
    state.setSends([outgoing]);
    // The read caught up after admission, so nothing is projected.
    state.setSnapshot(
      thread([message('received'), message('draft', { body_text: 'Sent' })])
    );
    expect(state.source.thread()).toBe(state.snapshot());
    state.setSends([]);
    expect(state.refresh).toHaveBeenCalledOnce();
  } finally {
    state.dispose();
  }
});

it('adopts the server identity without duplicating the sent message', () => {
  const state = setup();
  try {
    state.setSends([{ ...outgoing, messageIds: ['draft', 'server-message'] }]);
    state.setSnapshot(
      thread([
        message('received'),
        message('server-message', { body_text: 'Confirmed' }),
      ])
    );
    expect(state.source.thread()?.messages).toHaveLength(2);
    expect(state.source.thread()?.messages[1].body_text).toBe('Confirmed');
  } finally {
    state.dispose();
  }
});

it('keeps approved sends scoped to their thread when the source navigates', () => {
  const state = setup();
  try {
    state.setSends([outgoing]);
    state.setSnapshot(thread([message('other')], { db_id: 'other-thread' }));
    expect(
      state.source.thread()?.messages.map((message) => message.db_id)
    ).toEqual(['other']);
  } finally {
    state.dispose();
  }
});

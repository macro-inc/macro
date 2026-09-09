import type { ThreadQueryData, ThreadQueryResult } from '@queries/email/thread';
import type { ApiMessage, ApiThread } from '@service-email/generated/schemas';
import { batch, createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

function message(id: string, overrides: Partial<ApiMessage> = {}): ApiMessage {
  return {
    db_id: id,
    thread_db_id: 'thread',
    link_id: 'inbox',
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    to: [{ email: 'viewer@example.com' }],
    cc: [],
    bcc: [],
    attachments: [],
    attachments_draft: [],
    attachments_forwarded: [],
    labels: [],
    is_read: true,
    is_draft: false,
    is_sent: false,
    is_starred: false,
    has_attachments: false,
    ...overrides,
  };
}
function thread(messages: ApiMessage[]): ApiThread {
  return {
    db_id: 'thread',
    link_id: 'inbox',
    access_level: 'owner',
    inbox_visible: true,
    is_read: true,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    messages,
  };
}

import { createEmailThreadSource, toEmailThread } from './thread-source';

describe('thread query adaptation', () => {
  it('guards resource reads, retains available data during refresh errors, and clears it when switching threads', () =>
    createRoot((dispose) => {
      try {
        const [id, setId] = createSignal('thread');
        const [status, setStatus] = createSignal('pending');
        const [data, setData] = createSignal<ThreadQueryData | undefined>();
        const read = vi.fn(() => {
          if (status() === 'pending')
            throw new Error('suspending resource read');
          return data();
        });
        const query = {
          get isError() {
            return status() === 'error';
          },
          get isSuccess() {
            return status() === 'success';
          },
          get isLoading() {
            return status() === 'pending';
          },
          isFetching: false,
          isFetchingNextPage: false,
          hasNextPage: true,
          get data() {
            return read();
          },
        } as unknown as ThreadQueryResult<ThreadQueryData>;
        const source = createEmailThreadSource(id, query);
        expect(source.thread()).toBeUndefined();
        expect(read).not.toHaveBeenCalled();
        const original = thread([message('first')]);
        batch(() => {
          setData({ thread: original } as ThreadQueryData);
          setStatus('success');
        });
        expect(source.thread()?.messages[0].db_id).toBe('first');
        expect(source.thread()).not.toBe(original);
        setStatus('error');
        expect(source.thread()?.db_id).toBe('thread');
        setId('other');
        expect(source.thread()).toBeUndefined();
        batch(() => {
          setData(undefined);
          setStatus('success');
        });
        expect(source.thread()).toBeUndefined();
      } finally {
        dispose();
      }
    }));
  it('owns nested message data while preserving missing versus empty HTML', () => {
    const wire = thread([
      message('one', { body_replyless: '' }),
      message('two', { body_replyless: null }),
    ]);
    const projected = toEmailThread(wire);
    expect(projected.messages.map((m) => m.body_replyless)).toEqual(['', null]);
    projected.messages[0].to[0].email = 'changed@example.com';
    expect(wire.messages[0].to[0].email).toBe('viewer@example.com');
  });
});

it('exposes cached data when the first observed query result is an error', () =>
  createRoot((dispose) => {
    try {
      const cached = thread([message('cached')]);
      const query = {
        isError: true,
        isSuccess: false,
        isLoading: false,
        data: { thread: cached, hasMore: false },
      } as ThreadQueryResult<ThreadQueryData>;
      expect(
        createEmailThreadSource(() => 'thread', query).thread()?.messages[0]
          .db_id
      ).toBe('cached');
    } finally {
      dispose();
    }
  }));

it.each(['fetchOlder', 'refresh'] as const)(
  '%s remains pending until the query request finishes',
  async (operation) => {
    const { promise: request, resolve: finish } = Promise.withResolvers<void>();
    const { source, dispose } = createRoot((dispose) => ({
      dispose,
      source: createEmailThreadSource(() => 'thread', {
        isSuccess: false,
        isError: false,
        fetchNextPage: () =>
          operation === 'fetchOlder' ? request : Promise.resolve(),
        refetch: () => (operation === 'refresh' ? request : Promise.resolve()),
      } as unknown as ThreadQueryResult<ThreadQueryData>),
    }));
    try {
      let completed = false;
      const completion = source[operation]().then(() => {
        completed = true;
      });
      await Promise.resolve();
      expect(completed).toBe(false);
      finish();
      await completion;
      expect(completed).toBe(true);
    } finally {
      dispose();
    }
  }
);

it('keeps rendering and attachment identities while excluding transport metadata', () => {
  const wire = thread([
    message('message', {
      headers_json: { transport: 'private' },
      provider_history_id: 'sync-history',
      from: { email: 'sender@example.com', name: 'Sender', photo_url: 'photo' },
      labels: [
        {
          created_at: 'now',
          link_id: 'inbox',
          name: 'CATEGORY_PERSONAL',
          provider_label_id: 'UNREAD',
        },
      ],
      attachments: [
        {
          db_id: 'inline',
          content_id: 'image-cid',
          sfs_id: 'file',
          mime_type: 'image/png',
          filename: 'image.png',
          size_bytes: 123,
        },
      ],
      attachments_draft: [
        {
          id: 'draft-file',
          draft_id: 'message',
          content_type: 'text/plain',
          file_name: 'notes.txt',
          s3_key: 'notes',
          sha: 'sha',
          size: 42,
        },
      ],
      attachments_forwarded: [
        {
          attachment_id: 'forward-file',
          draft_id: 'message',
          message_provider_id: 'provider',
          provider_attachment_id: 'private-id',
          filename: 'forward.txt',
          mime_type: 'text/plain',
          size_bytes: 15,
        },
      ],
      provider_id: 'reply-provider-id',
      scheduled_send_time: '2026-10-01T12:00:00Z',
    }),
  ]);
  const projected = toEmailThread(wire).messages[0];
  expect(projected).toMatchObject({
    provider_id: 'reply-provider-id',
    scheduled_send_time: '2026-10-01T12:00:00Z',
    labels: [{ name: 'CATEGORY_PERSONAL', provider_label_id: 'UNREAD' }],
    attachments: [{ db_id: 'inline', content_id: 'image-cid', sfs_id: 'file' }],
    attachments_draft: [{ id: 'draft-file', s3_key: 'notes' }],
    attachments_forwarded: [
      { attachment_id: 'forward-file', filename: 'forward.txt' },
    ],
  });
  expect(projected).not.toHaveProperty('headers_json');
  expect(projected).not.toHaveProperty('provider_history_id');
  expect(projected.attachments_forwarded[0]).not.toHaveProperty(
    'message_provider_id'
  );
  // Feature state must not mutate the query cache's nested values.
  projected.from!.name = 'Changed';
  projected.labels[0].name = 'Changed';
  projected.attachments[0].filename = 'Changed';
  projected.attachments_draft[0].file_name = 'Changed';
  projected.attachments_forwarded[0].filename = 'Changed';
  expect(wire.messages[0].from?.name).toBe('Sender');
  expect(wire.messages[0].labels[0].name).toBe('CATEGORY_PERSONAL');
  expect(wire.messages[0].attachments[0].filename).toBe('image.png');
  expect(wire.messages[0].attachments_draft[0].file_name).toBe('notes.txt');
  expect(wire.messages[0].attachments_forwarded[0].filename).toBe(
    'forward.txt'
  );
});

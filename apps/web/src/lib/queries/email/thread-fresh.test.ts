import type { ApiMessage, ApiThread } from '@service-email/generated/schemas';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getThread = vi.hoisted(() => vi.fn());

vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
  // Authoritative lifecycle reads must bypass GraphQL even when it is enabled.
  isFeatureEnabled: () => true,
}));
vi.mock('@service-email/client', () => ({ emailClient: { getThread } }));

import { fetchFreshEmailThread } from './thread';

function message(dbId: string): ApiMessage {
  return {
    attachments: [],
    attachments_draft: [],
    attachments_forwarded: [],
    bcc: [],
    cc: [],
    created_at: '2026-09-21T00:00:00Z',
    db_id: dbId,
    has_attachments: false,
    is_draft: dbId === 'late-draft',
    is_read: true,
    is_sent: dbId !== 'late-draft',
    is_starred: false,
    labels: [],
    link_id: 'inbox',
    thread_db_id: 'thread',
    to: [],
    updated_at: '2026-09-21T00:00:00Z',
  };
}

function thread(messages: ApiMessage[]): ApiThread {
  return {
    access_level: 'owner',
    created_at: '2026-09-21T00:00:00Z',
    db_id: 'thread',
    inbox_visible: true,
    is_read: true,
    link_id: 'inbox',
    messages,
    updated_at: '2026-09-21T00:00:00Z',
  };
}

describe('fetchFreshEmailThread', () => {
  beforeEach(() => getThread.mockReset());

  it('continues past the first page until the requested draft is present', async () => {
    const firstPage = thread(
      Array.from({ length: 20 }, (_, index) => message(`sent-${index}`))
    );
    const lastPage = thread([message('late-draft')]);
    getThread
      .mockResolvedValueOnce(ok({ thread: firstPage }))
      .mockResolvedValueOnce(ok({ thread: lastPage }));

    const result = await fetchFreshEmailThread('thread', 'late-draft');

    expect(getThread).toHaveBeenNthCalledWith(1, {
      thread_id: 'thread',
      offset: 0,
      limit: 20,
    });
    expect(getThread).toHaveBeenNthCalledWith(2, {
      thread_id: 'thread',
      offset: 20,
      limit: 20,
    });
    expect(result.messages).toHaveLength(21);
    expect(result.messages.at(-1)?.db_id).toBe('late-draft');
  });
});

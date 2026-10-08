import 'fake-indexeddb/auto';
import {
  listLocalDrafts,
  localDraftStore,
  saveLocalDraft,
} from '@queries/email/local-drafts';
import type { ThreadQueryData, ThreadQueryResult } from '@queries/email/thread';
import { createMemo, createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { decodeBase64Utf8 } from '../../email-compose/core/decode-base64';
import { createComposeContext } from '../../email-compose/tests/capabilities';
import { mountReplyComposer } from '../../email-compose/tests/reply';
import { message } from '../../email-message/tests/messages';
import { selectThreadMessages } from '../core/thread-messages';
import { createThreadDrafts } from '../primitives/thread-drafts';
import { createEmailThreadSource } from './thread-source';

vi.mock('@queries/client', () => ({
  queryClient: {
    getQueryData: () => ({ authenticated: true, id: 'owner' }),
    getQueryCache: () => ({ subscribe: () => () => {} }),
  },
}));
vi.mock('@queries/calendar/invitations', () => ({
  invalidateInvitationScheduling: vi.fn(),
}));
vi.mock('@core/mobile/nativeStagedUpload', () => ({
  getNativeStagedUpload: () => undefined,
}));
afterEach(async () => {
  await localDraftStore.clear();
  await localDraftStore.close();
});

it.each([false, true])(
  'reopens an offline reply after leaving the thread (debounce finished=%s)',
  async (waitForQueue) => {
    const context = createComposeContext();
    context.connectivity.looksOffline = () => true;
    context.drafts.saveLocalDraft = saveLocalDraft;
    context.drafts.saveDraft = vi.fn(async (input) => ({
      ...input.clientHandles,
      inboxId: 'inbox',
      persistence: 'queued',
    }));
    const parent = message('parent');
    const reply = mountReplyComposer(context, () => parent);
    reply.edit('My offline reply');
    await reply.flushLocal();
    expect(context.notices.feedback.failure).not.toHaveBeenCalled();
    if (waitForQueue)
      await vi.waitFor(() =>
        expect(context.drafts.saveDraft).toHaveBeenCalled()
      );
    reply.dispose();
    await reply.flushLocal();
    await vi.waitFor(() => expect(context.drafts.saveDraft).toHaveBeenCalled());
    const stored = await listLocalDrafts();
    expect(stored).toHaveLength(1);
    expect(decodeBase64Utf8(stored[0].content.body_html ?? '')).toContain(
      'My offline reply'
    );
    expect(stored[0]).toMatchObject({
      threadId: 'thread',
      content: {
        replying_to_id: 'parent',
        to: [expect.objectContaining({ email: 'sender@example.com' })],
      },
    });
    const reopened = createRoot((dispose) => {
      const source = createEmailThreadSource(() => 'thread', {
        transport: 'graphql',
        isSuccess: true,
        isError: false,
        resolvedThreadId: 'thread',
        data: {
          thread: {
            db_id: 'thread',
            link_id: 'inbox',
            access_level: 'owner',
            messages: [parent],
          },
          hasMore: false,
        },
      } as unknown as ThreadQueryResult<ThreadQueryData>);
      const selected = createMemo(() => {
        const thread = source.thread();
        return thread && selectThreadMessages(thread);
      });
      return { dispose, drafts: createThreadDrafts(selected) };
    });
    try {
      await vi.waitFor(() =>
        expect(reopened.drafts.getDraftForMessage('parent')).toBeDefined()
      );
      expect(
        decodeBase64Utf8(
          reopened.drafts.getDraftForMessage('parent')!.body_html_sanitized ??
            ''
        )
      ).toContain('My offline reply');
    } finally {
      reopened.dispose();
    }
  }
);

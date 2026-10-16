import { $createImageNode, $createVideoNode } from '@macro-inc/lexical-core';
import { $getRoot } from 'lexical';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';
import { mountReplyComposer } from '../tests/reply';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it.each([
  ['standalone', 'image'],
  ['reply', 'image'],
  ['standalone', 'video'],
  ['reply', 'video'],
] as const)(
  'does not queue local blob-backed inline media: %s %s',
  async (kind, media) => {
    const context = createComposeContext();
    context.delivery.queueActive = () => true;
    context.connectivity.looksOffline = () => true;
    context.drafts.saveLocalDraft = vi.fn(async (input) => ({
      key: input.clientHandles?.draftId ?? input.draft.db_id!,
      draftId: input.clientHandles?.draftId ?? input.draft.db_id!,
      threadId:
        input.clientHandles?.threadId ?? input.draft.thread_db_id ?? undefined,
      accountId: 'owner',
      generation: 'local-generation',
      revision: 1,
      acknowledgedRevision: 0,
      status: 'dirty' as const,
      updatedAt: Date.now(),
      content: input.draft,
      attachments: [],
    }));
    const root =
      kind === 'standalone'
        ? mountEmailComposer(context)
        : mountReplyComposer(context);
    try {
      root.edit('Body with still-uploading image');
      root.editor.update(
        () =>
          $getRoot().append(
            (media === 'image' ? $createImageNode : $createVideoNode)({
              srcType: 'local',
              url: 'blob:http://localhost/audit-pending-upload',
              alt: 'audit',
            })
          ),
        { discrete: true }
      );
      if ('state' in root) root.state.context.onSend();
      else await root.sendEmail();
      await vi.advanceTimersByTimeAsync(0);
      expect(context.delivery.sendMessage).not.toHaveBeenCalled();
    } finally {
      root.dispose();
    }
  }
);

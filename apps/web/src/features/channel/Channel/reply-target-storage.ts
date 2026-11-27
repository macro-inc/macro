import type { PersistenceStorage } from '@app/lib/persistence';
import { z } from 'zod';
import type { UnifiedReplyTarget } from './unified-input-manager';

/** Starts every channel's stored reply binding; `clearComposerStorage` clears them on logout. */
const REPLY_TARGET_STORAGE_PREFIX = 'channel-reply-target:';

const storedTargetSchema = z.object({
  threadId: z.string().min(1),
  replyId: z.string().min(1).optional(),
});

/**
 * The message the unified input was replying to in one channel, by ids, in
 * localStorage. Leaving the channel and opening it again (another
 * conversation, another view, the list) brings the reply back with its
 * draft. It restores only while that thread still has an unsent reply
 * (`hasReplyDraft`), and never over a binding the history snapshot restored.
 */
export function replyTargetStorage(
  channelId: string,
  hasReplyDraft: (threadId: string) => boolean
): PersistenceStorage<UnifiedReplyTarget | undefined> {
  const key = `${REPLY_TARGET_STORAGE_PREFIX}${channelId}`;
  return {
    restore: (current) => {
      if (current) return undefined;
      const raw = localStorage.getItem(key);
      if (!raw) return undefined;
      const stored = storedTargetSchema.safeParse(JSON.parse(raw));
      if (!stored.success || !hasReplyDraft(stored.data.threadId)) {
        return undefined;
      }
      return stored.data;
    },
    write: (target) => {
      if (!target) {
        localStorage.removeItem(key);
        return;
      }
      localStorage.setItem(
        key,
        JSON.stringify({ threadId: target.threadId, replyId: target.replyId })
      );
    },
  };
}

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
 * Closing or sending a reply forgets the stored binding only while it is the
 * reply this mount was on, so the same channel open elsewhere on another
 * reply keeps its own.
 */
export function replyTargetStorage(
  channelId: string,
  hasReplyDraft: (threadId: string) => boolean
): PersistenceStorage<UnifiedReplyTarget | undefined> {
  const key = `${REPLY_TARGET_STORAGE_PREFIX}${channelId}`;
  // The reply this mount is on, in its stored form.
  let bound: string | null = null;
  return {
    restore: (current) => {
      if (current) {
        bound = storedForm(current);
        return undefined;
      }
      const raw = localStorage.getItem(key);
      if (!raw) return undefined;
      const parsed = storedTargetSchema.safeParse(JSON.parse(raw));
      if (!parsed.success || !hasReplyDraft(parsed.data.threadId)) {
        return undefined;
      }
      bound = storedForm(parsed.data);
      return parsed.data;
    },
    write: (target) => {
      if (!target) {
        if (bound !== null && localStorage.getItem(key) === bound) {
          localStorage.removeItem(key);
        }
        bound = null;
        return;
      }
      bound = storedForm(target);
      localStorage.setItem(key, bound);
    },
  };
}

function storedForm(target: { threadId: string; replyId?: string }): string {
  return JSON.stringify({ threadId: target.threadId, replyId: target.replyId });
}

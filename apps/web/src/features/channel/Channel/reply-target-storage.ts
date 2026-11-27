import type { PersistenceStorage } from '@app/lib/persistence';
import { Result } from 'neverthrow';
import { z } from 'zod';
import type { UnifiedReplyTarget } from './unified-input-manager';

/** Starts every channel's stored reply binding; `clearComposerStorage` clears them on logout. */
const REPLY_TARGET_STORAGE_PREFIX = 'channel-reply-target:';

const storedTargetSchema = z.object({
  threadId: z.string().min(1),
  replyId: z.string().min(1).optional(),
});

type StoredTarget = z.infer<typeof storedTargetSchema>;

const parseJson = Result.fromThrowable((json: string): unknown =>
  JSON.parse(json)
);

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
      const stored = readStoredTarget(key);
      if (!stored || !hasReplyDraft(stored.threadId)) return undefined;
      bound = storedForm(stored);
      return stored;
    },
    write: (target) => {
      if (!target) {
        const stored = readStoredTarget(key);
        if (bound !== null && stored && storedForm(stored) === bound) {
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

/** The binding stored under `key`, or nothing when what is there is not one. */
function readStoredTarget(key: string): StoredTarget | undefined {
  const raw = localStorage.getItem(key);
  if (!raw) return undefined;
  const json = parseJson(raw);
  if (json.isErr()) return undefined;
  const parsed = storedTargetSchema.safeParse(json.value);
  return parsed.success ? parsed.data : undefined;
}

function storedForm(target: StoredTarget): string {
  return JSON.stringify({ threadId: target.threadId, replyId: target.replyId });
}

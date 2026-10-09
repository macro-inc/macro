import type { ImagePolicy } from '@macro-inc/email-renderer';
import type {
  EmailPreparation,
  PreparedEmailLease,
} from '../email-message/context/email-preparation';
import type { EmailThread } from './core/email-thread';
import { selectThreadMessages } from './core/thread-messages';
import {
  isTruncatedMiddleMessage,
  isUnreadMessage,
} from './core/thread-window';

export interface ThreadPreparationSource {
  read(
    threadId: string,
    localOnly: boolean,
    retain: (release: () => void) => void
  ): Promise<{ thread: EmailThread; hasMore: boolean } | undefined>;
}

/** No resource mounting or remote image requests are started by preparation. */
export function prepareThreads(
  preparation: EmailPreparation,
  source: ThreadPreparationSource,
  images: ImagePolicy,
  ids: readonly string[],
  priority: number,
  localOnly = false
): () => void {
  let cancelled = false;
  const leases = new Set<PreparedEmailLease>();
  const sources = new Set<() => void>();
  async function prepare() {
    for (const id of ids.slice(0, 5)) {
      if (cancelled) return;
      const page = await source.read(id, localOnly, (release) => {
        if (cancelled) release();
        else sources.add(release);
      });
      if (!page || cancelled) continue;
      const selected = selectThreadMessages(page.thread);
      const messages = selected.filtered;
      let admitted = 0;
      for (let i = 0; i < messages.length && admitted < 6; i++) {
        const message = messages[i];
        if (
          isTruncatedMiddleMessage(i, messages.length) ||
          (i !== messages.length - 1 &&
            !isUnreadMessage(message) &&
            !selected.draftMap[message.db_id])
        )
          continue;
        admitted++;
        let lease: PreparedEmailLease | undefined;
        try {
          lease = preparation.acquire({
            messageId: message.db_id,
            threadId: message.thread_db_id,
            mailboxId: message.link_id,
            input: {
              html: message.body_html_sanitized,
              replylessHtml: message.body_replyless,
              text: message.body_text,
            },
            options: {
              showFullContent: i === 0 && !page.hasMore,
              images,
            },
            priority,
          });
          leases.add(lease);
          await lease.promise;
        } catch {
          /* Optional preparation remains a normal foreground miss. */
        } finally {
          if (lease && leases.delete(lease)) {
            lease.release();
          }
        }
        if (cancelled) return;
      }
    }
  }
  async function run() {
    try {
      await prepare();
    } catch {
      // Source failure leaves a normal foreground miss and releases retention.
      release();
    }
  }
  void run();
  function release() {
    cancelled = true;
    for (const release of sources) release();
    sources.clear();
    for (const lease of leases) lease.release();
    leases.clear();
  }
  return release;
}

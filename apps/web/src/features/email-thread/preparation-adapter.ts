import type {
  EmailPreparation,
  PreparedEmailLease,
} from '../email-message/context/email-preparation';
import { emailImagePolicy } from '../email-message/rendering-policy';
import { selectThreadMessages } from './core/thread-messages';
import {
  isTruncatedMiddleMessage,
  isUnreadMessage,
} from './core/thread-window';
import { readThreadForPreparation } from './queries/preparation-source';

/** No resource mounting or remote image requests are started by preparation. */
export function prepareEmailThreads(
  preparation: EmailPreparation,
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
      const source = await readThreadForPreparation(
        id,
        localOnly,
        (release) => {
          if (cancelled) release();
          else sources.add(release);
        }
      );
      if (!source || cancelled) continue;
      const selected = selectThreadMessages(source.thread);
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
              showFullContent: i === 0 && !source.hasMore,
              images: emailImagePolicy,
            },
            priority,
          });
          leases.add(lease);
          await lease.promise;
        } catch {
          /* Optional preparation remains a normal foreground miss. */
        } finally {
          if (lease) {
            lease.release();
            leases.delete(lease);
          }
        }
        if (cancelled) return;
      }
    }
  }
  void prepare();
  return () => {
    cancelled = true;
    for (const release of sources) release();
    sources.clear();
    for (const lease of leases) lease.release();
    leases.clear();
  };
}

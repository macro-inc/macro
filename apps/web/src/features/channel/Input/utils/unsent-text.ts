import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { makeInputValuePersistenceKey } from './persistence';

/** A mounted composer that keeps its draft under a persistence key. */
type DraftComposer = {
  value: () => string;
  /** Put text into the composer, which holds nothing. */
  restoreText: (text: string) => void;
};

const composers = new Map<string, DraftComposer>();

/** Register a mounted composer by the key its draft is stored under. */
export function registerDraftComposer(
  persistenceKey: string,
  composer: DraftComposer
): () => void {
  composers.set(persistenceKey, composer);
  return () => {
    if (composers.get(persistenceKey) === composer)
      composers.delete(persistenceKey);
  };
}

/** The draft `makePersisted` stored under the key, as the composer reads it. */
function storedDraft(key: string): string {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    return typeof stored === 'string' ? stored : '';
  } catch {
    return '';
  }
}

function storeDraft(key: string, text: string): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(text));
    return true;
  } catch {
    return false;
  }
}

function offerCopy(text: string) {
  toast.failure(t('channelMessages.unsentKept'), {
    actions: [
      {
        label: t('channelMessages.copyUnsent'),
        onClick: () =>
          fireAndForget(navigator.clipboard.writeText(text), 'channel-input'),
      },
    ],
  });
}

/**
 * Keep the text of a channel post the server refused, so what a person typed
 * is never dropped with the message's row. It goes back into the draft of the
 * thread's composer when that is open, of the channel's otherwise:
 *
 * - a mounted composer that is empty takes it, one that already shows it is
 *   left alone, and one holding a newer draft keeps that and the text is
 *   offered for copying;
 * - with no composer mounted, it is written to the stored draft, after a
 *   blank line when one is there, and shows when the channel next opens.
 *
 * Only the text is kept: mentions come back as written, attachments do not.
 */
export function keepUnsentPostText(post: {
  channelId: string;
  threadId?: string | null;
  content: string;
}) {
  const text = post.content;
  if (text.trim().length === 0) return;
  const threadKey = post.threadId
    ? makeInputValuePersistenceKey({
        channelId: `channel:${post.channelId}`,
        threadId: post.threadId,
      })
    : undefined;
  const key =
    threadKey && composers.has(threadKey)
      ? threadKey
      : makeInputValuePersistenceKey({ channelId: post.channelId });

  const composer = composers.get(key);
  if (composer) {
    const current = composer.value();
    if (current.includes(text)) return;
    if (current.trim().length === 0) composer.restoreText(text);
    else offerCopy(text);
    return;
  }
  const stored = storedDraft(key);
  if (stored.includes(text)) return;
  const kept = storeDraft(
    key,
    stored.trim().length === 0 ? text : `${stored}\n\n${text}`
  );
  if (!kept) offerCopy(text);
}

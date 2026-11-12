import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { makeInputValuePersistenceKey } from './persistence';

const COPY_OFFER_MS = 60_000;

/** A mounted composer that keeps its draft under a persistence key. */
type DraftComposer = {
  value: () => string;
  /**
   * Put text into the composer, which holds nothing. Answers false when it
   * cannot take it now.
   */
  restoreText: (text: string) => boolean;
};

/** A channel open in two splits mounts two composers on one draft. */
const composers = new Map<string, Set<DraftComposer>>();

/**
 * Text handed to a composer whose own value has not caught up yet, so a
 * second refused post in the same turn does not replace the first.
 */
const handed = new WeakMap<DraftComposer, string>();

/** Register a mounted composer by the key its draft is stored under. */
export function registerDraftComposer(
  persistenceKey: string,
  composer: DraftComposer
): () => void {
  const mounted = composers.get(persistenceKey) ?? new Set();
  mounted.add(composer);
  composers.set(persistenceKey, mounted);
  return () => {
    mounted.delete(composer);
    if (mounted.size === 0 && composers.get(persistenceKey) === mounted)
      composers.delete(persistenceKey);
  };
}

function composerText(composer: DraftComposer): string {
  const value = composer.value();
  return value.trim().length > 0 ? value : (handed.get(composer) ?? '');
}

/** Whether a draft already holds the text, alone or as its last paragraph. */
function holds(draft: string, text: string): boolean {
  const kept = draft.trim();
  const wanted = text.trim();
  return kept === wanted || kept.endsWith(`\n\n${wanted}`);
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
    // It can be the only place the text is left.
    duration: COPY_OFFER_MS,
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
 *   blank line when one is there, and shows when the channel next opens. It
 *   is offered for copying too, since a refusal can mean the person can no
 *   longer open that channel.
 *
 * Only the text is kept: mentions come back as written, attachments do not.
 * Answers whether the person was told, with the text offered for copying.
 */
export function keepUnsentPostText(post: {
  channelId: string;
  threadId?: string | null;
  content: string;
}): boolean {
  const text = post.content;
  if (text.trim().length === 0) return false;
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

  const mounted = [...(composers.get(key) ?? [])];
  if (mounted.length > 0) {
    if (mounted.some((composer) => holds(composerText(composer), text)))
      return false;
    const empty = mounted.find(
      (composer) => composerText(composer).trim().length === 0
    );
    if (!empty) {
      offerCopy(text);
      return true;
    }
    if (!empty.restoreText(text)) {
      offerCopy(text);
      return true;
    }
    handed.set(empty, text);
    setTimeout(() => handed.delete(empty), 0);
    return false;
  }
  const stored = storedDraft(key);
  if (holds(stored, text)) return false;
  storeDraft(key, stored.trim().length === 0 ? text : `${stored}\n\n${text}`);
  offerCopy(text);
  return true;
}

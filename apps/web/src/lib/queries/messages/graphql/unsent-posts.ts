import { batch } from 'solid-js';
import { createStore } from 'solid-js/store';

/** How long a post may wait in the queue before its row says it is not sent. */
export const NOT_SENT_AFTER_MS = 5_000;

const [notSent, setNotSent] = createStore<Record<string, true | undefined>>({});
let timer: ReturnType<typeof setTimeout> | undefined;
let queuedPosts: ReadonlyMap<string, number> = new Map();

/**
 * Whether a channel post has waited in the device cache's queue for more than
 * `NOT_SENT_AFTER_MS`. Reactive, and tracked per message id.
 */
export function isChannelPostNotSent(messageId: string): boolean {
  return notSent[messageId] === true;
}

/**
 * The channel posts the queue holds now, by message id, with when each was
 * queued. Each reads as not sent from `NOT_SENT_AFTER_MS` after that until a
 * later call leaves it out.
 */
export function trackQueuedPosts(posts: ReadonlyMap<string, number>) {
  queuedPosts = posts;
  refresh();
}

function refresh() {
  clearTimeout(timer);
  timer = undefined;
  const now = Date.now();
  let next: number | undefined;
  const due = new Set<string>();
  for (const [messageId, queuedAtMs] of queuedPosts) {
    const at = queuedAtMs + NOT_SENT_AFTER_MS;
    if (at <= now) due.add(messageId);
    else next = Math.min(next ?? at, at);
  }
  batch(() => {
    for (const messageId of Object.keys(notSent)) {
      if (!due.has(messageId)) setNotSent(messageId, undefined);
    }
    for (const messageId of due) {
      if (!notSent[messageId]) setNotSent(messageId, true);
    }
  });
  if (next !== undefined) timer = setTimeout(refresh, next - now);
}

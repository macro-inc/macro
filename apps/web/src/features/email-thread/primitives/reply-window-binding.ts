import { type Accessor, createEffect, on } from 'solid-js';
import type { ReplyType } from '../../email-compose/core/reply-type';
import type {
  EmailReplyTarget,
  EmailReplyWindow,
} from '../context/email-thread-view-context';

const sameReply = (a: EmailReplyTarget, b: EmailReplyTarget) =>
  a.threadId === b.threadId && a.messageId === b.messageId;

/**
 * Connects one message's reply to the app's reply window. While the window
 * holds the reply, the thread shows a notice instead of a second editor and
 * reply keys bring the window forward. A reply the window gives back opens
 * here again, and one it sent or discarded drops its draft here too.
 */
export function createReplyWindowBinding(options: {
  /** The app's reply window, or undefined while replies stay in the thread. */
  replyWindow: Accessor<EmailReplyWindow | undefined>;
  target: Accessor<EmailReplyTarget | undefined>;
  /** Reply, Reply all or Forward was asked for on this message. */
  replyRequested: Accessor<boolean>;
  clearReplyRequest: () => void;
  openInline: (replyType: ReplyType) => void;
  /** Forgets the draft this thread last saw; its window copy is gone. */
  dropDraft: () => void;
}) {
  const inWindow = () => {
    const target = options.target();
    return !!target && !!options.replyWindow()?.holds(target);
  };
  const isThisReply = (other: EmailReplyTarget) => {
    const target = options.target();
    return !!target && sameReply(target, other);
  };

  createEffect(() => {
    const replyWindow = options.replyWindow();
    if (!replyWindow || !inWindow() || !options.replyRequested()) return;
    options.clearReplyRequest();
    replyWindow.focus();
  });
  // Only hand-offs that happen while this thread is open: a stale one must
  // not reopen the reply, or drop a newer draft, when the thread opens later.
  createEffect(
    on(
      () => options.replyWindow()?.returned(),
      (returned) => {
        if (!returned || !isThisReply(returned)) return;
        options.replyWindow()?.clearReturned();
        options.openInline(returned.replyType);
      },
      { defer: true }
    )
  );
  createEffect(
    on(
      () => options.replyWindow()?.removed(),
      (removed) => {
        if (removed && isThisReply(removed)) options.dropDraft();
      },
      { defer: true }
    )
  );

  return {
    inWindow,
    /** Opens this reply, already saved, in the window; undefined without one. */
    popOut: () => {
      const replyWindow = options.replyWindow();
      if (!replyWindow) return undefined;
      return (replyType: ReplyType) => {
        const target = options.target();
        if (target) replyWindow.open({ ...target, replyType });
      };
    },
  };
}

import { match } from 'ts-pattern';
import type {
  ComposeNoticeOptions,
  EmailComposeFeedback,
  EmailDelivery,
} from '../context/compose-capabilities';

/** How long a send may go without progress before its notice stops waiting on screen. */
const STALLED_SEND_MS = 30_000;

/**
 * Tells the user only what a queued send has done. Undo stays on offer until
 * the server's own deadline, and the send is called sent once it is delivered.
 *
 * One notice follows the send and changes in place at each step, so it never
 * leaves and comes back while the send is in motion: it stays until the
 * outcome, then becomes it. A send that waits instead (queued offline,
 * retrying, or waiting on sign-in) can do so for hours, so its notice expires
 * as usual, and a new one follows the send once the server accepts it.
 */
export function announceQueuedSend(options: {
  notices: EmailComposeFeedback;
  delivery: Pick<EmailDelivery, 'watchSend'>;
  sendAttemptId: string | undefined;
  queuedOffline: boolean;
  undo: (() => void) | undefined;
  /** The send failed or was cancelled, so nothing was delivered. */
  onUndelivered?: () => void;
}): void {
  const { notices, undo } = options;
  const watched =
    options.sendAttemptId !== undefined &&
    options.delivery.watchSend !== undefined;
  let inMotion = watched && !options.queuedOffline;
  let notice: number | undefined;
  // Only the user closes a notice that waits for the outcome.
  let progressDismissed = false;
  let sendingMessage = 'Sending…';
  let offeringUndo = false;
  let undoRequested = false;
  let accepted = false;
  let finished = false;
  let lastProgress: string | undefined;
  let lastUndoUntil: string | undefined;
  let undoDeadline: ReturnType<typeof setTimeout> | undefined;
  let stall: ReturnType<typeof setTimeout> | undefined;

  const show = (
    tone: 'success' | 'failure' | 'alert',
    message: string,
    noticeOptions?: ComposeNoticeOptions
  ) => {
    const persistent = noticeOptions?.persistent ?? false;
    try {
      const shown = notices.feedback[tone](message, {
        ...noticeOptions,
        // Another send's notice with the same text is a different notice.
        stack: true,
        replace: notice,
        onDismiss: () => {
          if (notice !== shown) return;
          notice = undefined;
          if (persistent) progressDismissed = true;
        },
      });
      notice = shown;
    } catch (error) {
      notices.reportError(error);
    }
  };
  const settle = () => {
    clearTimeout(undoDeadline);
    clearTimeout(stall);
    offeringUndo = false;
  };
  const withdraw = () => {
    settle();
    const withdrawn = notice;
    notice = undefined;
    if (withdrawn != null) notices.feedback.dismiss(withdrawn);
  };
  // Terminal notices use normal expiry; later progress never takes them back.
  const finish = (
    tone: 'success' | 'failure' | 'alert',
    message: string,
    noticeOptions?: ComposeNoticeOptions
  ) => {
    settle();
    show(tone, message, noticeOptions);
    notice = undefined;
  };
  const sending = (message: string, offerUndo: boolean) => {
    sendingMessage = message;
    offeringUndo = offerUndo && undo !== undefined;
    show('success', message, {
      actions: offeringUndo
        ? [
            {
              label: 'Undo',
              kind: 'undo',
              onClick: () => {
                undoRequested = true;
                withdraw();
                undo?.();
              },
            },
          ]
        : undefined,
      persistent: inMotion,
    });
  };
  // A send that stops making progress stops holding its notice on screen.
  const watchForStall = () => {
    clearTimeout(stall);
    if (!inMotion) return;
    stall = setTimeout(() => {
      // Server acceptance only means the durable queue accepted the intent,
      // not that SMTP has begun or accepted anything. A local timer cannot
      // infer delivery uncertainty; only the server's typed outcome can.
      inMotion = false;
      if (notice != null)
        sending(accepted ? 'Still sending…' : sendingMessage, offeringUndo);
    }, STALLED_SEND_MS);
  };
  // Delivery has begun: Undo goes, and the notice waits for the outcome.
  const closeUndo = () => {
    const wasOffering = offeringUndo;
    settle();
    if (wasOffering && notice != null) sending('Sending…', false);
    watchForStall();
  };

  sending(options.queuedOffline ? 'Email queued to send' : 'Sending…', true);
  if (!options.sendAttemptId) return;
  watchForStall();
  options.delivery.watchSend?.(options.sendAttemptId, (progress) => {
    if (finished) return;
    const changed = progress.state !== lastProgress;
    lastProgress = progress.state;
    match(progress)
      .with({ state: 'pending' }, () => {
        if (!changed) return;
        // After acceptance, pending means delivery or cancellation has begun.
        if (accepted) closeUndo();
        else watchForStall();
      })
      .with({ state: 'accepted' }, ({ undoUntil }) => {
        if (!changed && undoUntil === lastUndoUntil) return;
        lastUndoUntil = undoUntil;
        accepted = true;
        if (undoRequested) return;
        // A send that waited has just been accepted: its notice may have
        // expired. One the user dismissed stays dismissed.
        const reopen = !inMotion && !progressDismissed;
        inMotion = true;
        const remaining = Date.parse(undoUntil) - Date.now();
        if (remaining <= 0) {
          if (reopen) sending('Sending…', false);
          closeUndo();
          return;
        }
        if (reopen) sending('Sending…', true);
        clearTimeout(stall);
        clearTimeout(undoDeadline);
        undoDeadline = setTimeout(closeUndo, remaining);
      })
      .with({ state: 'sent' }, () => {
        finished = true;
        finish('success', 'Email sent');
      })
      .with({ state: 'failed' }, () => {
        finished = true;
        finish('failure', 'Email failed to send', {
          // Durable recovery remains in the conversation and Drafts. Keeping
          // this toast persistent makes it resurface when its page returns.
          subtext:
            'See the conversation or Drafts for the reason and recovery options.',
          persistent: false,
        });
        options.onUndelivered?.();
      })
      .with({ state: 'cancelled' }, () => {
        finished = true;
        withdraw();
        options.onUndelivered?.();
      })
      .with({ state: 'unconfirmed' }, () =>
        finish('alert', 'Delivery unconfirmed', {
          subtext: 'Check your sent mail. We will not resend automatically.',
        })
      )
      .with({ state: 'untracked' }, withdraw)
      .exhaustive();
  });
}

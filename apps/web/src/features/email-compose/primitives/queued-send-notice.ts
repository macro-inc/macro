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
  // The outcome stays until it is read; later progress never takes it back.
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
      inMotion = false;
      if (notice != null) sending(sendingMessage, offeringUndo);
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
  options.delivery.watchSend?.(options.sendAttemptId, (progress) =>
    match(progress)
      .with({ state: 'pending' }, () => {
        // After acceptance, pending means delivery or cancellation has begun.
        if (accepted) closeUndo();
        else watchForStall();
      })
      .with({ state: 'accepted' }, ({ undoUntil }) => {
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
      .with({ state: 'sent' }, () => finish('success', 'Email sent'))
      .with({ state: 'failed' }, () => {
        finish('failure', 'Email failed to send', {
          subtext:
            'Open its conversation or Drafts and choose Cancel to recover the draft.',
          persistent: true,
        });
        options.onUndelivered?.();
      })
      .with({ state: 'cancelled' }, () => {
        withdraw();
        options.onUndelivered?.();
      })
      .with({ state: 'unconfirmed' }, () =>
        finish('alert', 'Delivery unconfirmed', {
          subtext: 'Check your sent mail. We will not resend automatically.',
        })
      )
      .with({ state: 'untracked' }, withdraw)
      .exhaustive()
  );
}

import { match } from 'ts-pattern';
import type {
  ComposeNoticeOptions,
  EmailComposeFeedback,
  EmailDelivery,
} from '../context/compose-capabilities';

/**
 * Tells the user only what a queued send has done. Undo stays on offer until
 * the server's own deadline, and the send is called sent once it is delivered.
 *
 * One notice follows the send and changes in place at each step, so it never
 * leaves and comes back while the send is in motion: it stays until the
 * outcome, then becomes it. A send queued offline can wait for hours, so its
 * notice expires as usual, and a new one follows the send once it goes out.
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
  let offeringUndo = false;
  let undoRequested = false;
  let accepted = false;
  let undoDeadline: ReturnType<typeof setTimeout> | undefined;

  const show = (
    tone: 'success' | 'failure' | 'alert',
    message: string,
    noticeOptions?: ComposeNoticeOptions
  ) => {
    try {
      const shown = notices.feedback[tone](message, {
        ...noticeOptions,
        replace: notice,
        onDismiss: () => {
          if (notice === shown) notice = undefined;
        },
      });
      notice = shown;
    } catch (error) {
      notices.reportError(error);
    }
  };
  const settle = () => {
    clearTimeout(undoDeadline);
    offeringUndo = false;
  };
  const withdraw = () => {
    settle();
    if (notice != null) notices.feedback.dismiss(notice);
    notice = undefined;
  };
  const sending = (message: string, offerUndo: boolean) => {
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
  // Delivery has begun: Undo goes, and the notice waits for the outcome.
  const closeUndo = () => {
    const wasOffering = offeringUndo;
    settle();
    if (wasOffering && notice != null) sending('Sending…', false);
  };

  sending(options.queuedOffline ? 'Email queued to send' : 'Sending…', true);
  if (!options.sendAttemptId) return;
  options.delivery.watchSend?.(options.sendAttemptId, (progress) =>
    match(progress)
      .with({ state: 'pending' }, () => {
        // After acceptance, pending means delivery or cancellation has begun.
        if (accepted) closeUndo();
      })
      .with({ state: 'accepted' }, ({ undoUntil }) => {
        accepted = true;
        if (undoRequested) return;
        // A send queued offline has just gone out; one sent online already
        // shows its notice, and one the user dismissed stays dismissed.
        const wentOut = !inMotion;
        inMotion = true;
        const remaining = Date.parse(undoUntil) - Date.now();
        if (remaining <= 0) {
          closeUndo();
          return;
        }
        if (wentOut) sending('Sending…', true);
        clearTimeout(undoDeadline);
        undoDeadline = setTimeout(closeUndo, remaining);
      })
      .with({ state: 'sent' }, () => {
        settle();
        show('success', 'Email sent');
      })
      .with({ state: 'failed' }, () => {
        settle();
        show('failure', 'Email failed to send', {
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
      .with({ state: 'unconfirmed' }, () => {
        settle();
        show('alert', 'Delivery unconfirmed', {
          subtext: 'Check your sent mail. We will not resend automatically.',
        });
      })
      .with({ state: 'untracked' }, withdraw)
      .exhaustive()
  );
}

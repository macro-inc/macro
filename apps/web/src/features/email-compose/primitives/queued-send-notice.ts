import { match } from 'ts-pattern';
import type {
  EmailComposeFeedback,
  EmailDelivery,
} from '../context/compose-capabilities';

/**
 * Tells the user only what a queued send has done. Undo stays on offer until
 * the server's own deadline, and the send is called sent once it is delivered.
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
  let undoNotice: number | undefined;
  let undoRequested = false;
  let accepted = false;
  const withdrawUndo = () => {
    if (undoNotice != null) notices.feedback.dismiss(undoNotice);
    undoNotice = undefined;
  };
  const offerUndo = (message: string, duration?: number) => {
    try {
      undoNotice = notices.feedback.success(message, {
        actions: undo
          ? [
              {
                label: 'Undo',
                onClick: () => {
                  undoRequested = true;
                  withdrawUndo();
                  undo();
                },
              },
            ]
          : undefined,
        duration,
      });
    } catch (error) {
      notices.reportError(error);
    }
  };
  offerUndo(options.queuedOffline ? 'Email queued to send' : 'Sending…');
  if (!options.sendAttemptId) return;
  options.delivery.watchSend?.(options.sendAttemptId, (progress) =>
    match(progress)
      .with({ state: 'pending' }, () => {
        // After acceptance, pending means delivery or cancellation has begun.
        if (accepted) withdrawUndo();
      })
      .with({ state: 'accepted' }, ({ undoUntil }) => {
        accepted = true;
        const remaining = Date.parse(undoUntil) - Date.now();
        if (!undoRequested && remaining > 0) offerUndo('Sending…', remaining);
        else withdrawUndo();
      })
      .with({ state: 'sent' }, () => {
        withdrawUndo();
        notices.feedback.success('Email sent');
      })
      .with({ state: 'failed' }, () => {
        withdrawUndo();
        notices.feedback.failure('Email failed to send', {
          subtext:
            'Open its conversation or Drafts and choose Cancel to recover the draft.',
          persistent: true,
        });
        options.onUndelivered?.();
      })
      .with({ state: 'cancelled' }, () => {
        withdrawUndo();
        options.onUndelivered?.();
      })
      .with({ state: 'unconfirmed' }, () => {
        withdrawUndo();
        notices.feedback.alert('Delivery unconfirmed', {
          subtext: 'Check your sent mail. We will not resend automatically.',
        });
      })
      .exhaustive()
  );
}

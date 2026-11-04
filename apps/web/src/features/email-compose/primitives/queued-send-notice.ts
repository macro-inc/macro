import { match } from 'ts-pattern';
import type {
  EmailComposeFeedback,
  EmailDelivery,
} from '../context/compose-capabilities';

/**
 * Tells the user only what a queued send has done. Undo stays on offer until
 * the server's own deadline, and the send is called sent once it is delivered.
 * Until then the undo keys (z, ⌘Z) undo it too, even after another notice
 * replaces this one.
 */
export function announceQueuedSend(options: {
  notices: EmailComposeFeedback;
  delivery: Pick<EmailDelivery, 'watchSend'>;
  sendAttemptId: string | undefined;
  queuedOffline: boolean;
  undo: (() => void) | undefined;
  /** The send failed or was cancelled, so nothing was delivered. */
  onUndelivered?: () => void;
}): {
  /**
   * Puts the send back on top of the undo list, above work the send caused
   * (marking its thread done), so the undo keys reach the send first.
   */
  raiseUndo(): void;
} {
  const { notices, undo } = options;
  let undoNotice: number | undefined;
  let undoEntry: { dispose(): void } | undefined;
  let undoRequested = false;
  let accepted = false;
  const withdrawUndo = () => {
    if (undoNotice != null) notices.feedback.dismiss(undoNotice);
    undoNotice = undefined;
  };
  const closeUndoWindow = () => {
    withdrawUndo();
    undoEntry?.dispose();
    undoEntry = undefined;
  };
  const requestUndo = () => {
    undoRequested = true;
    closeUndoWindow();
    undo?.();
  };
  const offerUndo = (message: string, duration?: number) => {
    try {
      undoNotice = notices.feedback.success(message, {
        actions: undo ? [{ label: 'Undo', onClick: requestUndo }] : undefined,
        duration,
      });
    } catch (error) {
      notices.reportError(error);
    }
  };
  const raiseUndo = () => {
    if (!undoEntry) return;
    undoEntry.dispose();
    undoEntry = notices.pushUndo(requestUndo);
  };
  offerUndo(options.queuedOffline ? 'Email queued to send' : 'Sending…');
  if (!options.sendAttemptId) return { raiseUndo };
  // Only a tracked send has a known end to its undo window.
  if (undo) undoEntry = notices.pushUndo(requestUndo);
  options.delivery.watchSend?.(options.sendAttemptId, (progress) =>
    match(progress)
      .with({ state: 'pending' }, () => {
        // After acceptance, pending means delivery or cancellation has begun.
        if (accepted) closeUndoWindow();
      })
      .with({ state: 'accepted' }, ({ undoUntil }) => {
        accepted = true;
        const remaining = Date.parse(undoUntil) - Date.now();
        withdrawUndo();
        if (undoRequested || remaining <= 0) closeUndoWindow();
        else offerUndo('Sending…', remaining);
      })
      .with({ state: 'sent' }, () => {
        closeUndoWindow();
        notices.feedback.success('Email sent');
      })
      .with({ state: 'failed' }, () => {
        closeUndoWindow();
        notices.feedback.failure('Email failed to send', {
          subtext:
            'Open its conversation or Drafts and choose Cancel to recover the draft.',
          persistent: true,
        });
        options.onUndelivered?.();
      })
      .with({ state: 'cancelled' }, () => {
        closeUndoWindow();
        options.onUndelivered?.();
      })
      .with({ state: 'unconfirmed' }, () => {
        closeUndoWindow();
        notices.feedback.alert('Delivery unconfirmed', {
          subtext: 'Check your sent mail. We will not resend automatically.',
        });
      })
      .with({ state: 'untracked' }, closeUndoWindow)
      .exhaustive()
  );
  return { raiseUndo };
}

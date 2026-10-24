import { match } from 'ts-pattern';

/** A deliberate send's state, as DSS records it. */
export type DeliveryState =
  | 'pending'
  | 'sending'
  | 'unknown'
  | 'accepted'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed';

export type DeliveryPresentation = {
  label: string;
  detail: string;
  tone: 'muted' | 'read' | 'error' | 'uncertain';
  icon: 'clock' | 'spinner' | 'check' | 'checks' | 'warning';
};

/** Known failure codes in plain words; never a provider response. */
export function sendFailure(code: string | null | undefined): string {
  return match(code ?? '')
    .with(
      'send_expired',
      () =>
        'This message waited 10 minutes and was not sent. Edit and retry when you’re ready.'
    )
    .with(
      'disconnected',
      () => 'Your WhatsApp is disconnected. Link it again in External.'
    )
    .with(
      'forbidden',
      'not_found',
      () => 'You can no longer send to this group from Macro.'
    )
    .with(
      'refreshing',
      'temporarily_unavailable',
      () => 'WhatsApp is temporarily unavailable. Try again in a little while.'
    )
    .with(
      'conflict',
      () => 'This message changed while sending. Review it and send again.'
    )
    .otherwise(
      () =>
        'WhatsApp didn’t take this message. Your text is saved; review it and try again.'
    );
}

export function deliveryPresentation(
  state: DeliveryState,
  errorCode?: string | null
): DeliveryPresentation {
  return match(state)
    .with('pending', () => ({
      label: 'Queued',
      detail: 'Waiting to send from your WhatsApp.',
      tone: 'muted' as const,
      icon: 'clock' as const,
    }))
    .with('sending', () => ({
      label: 'Sending…',
      detail: 'Sending from your WhatsApp.',
      tone: 'muted' as const,
      icon: 'spinner' as const,
    }))
    .with('accepted', 'sent', () => ({
      label: 'Sent',
      detail: 'WhatsApp accepted this message. Delivery is not confirmed yet.',
      tone: 'muted' as const,
      icon: 'check' as const,
    }))
    .with('delivered', () => ({
      label: 'Delivered',
      detail: 'WhatsApp reported this message delivered.',
      tone: 'muted' as const,
      icon: 'checks' as const,
    }))
    .with('read', () => ({
      label: 'Read',
      detail: 'WhatsApp reported this message read.',
      tone: 'read' as const,
      icon: 'checks' as const,
    }))
    .with('failed', () => ({
      label: 'Not sent',
      detail: sendFailure(errorCode),
      tone: 'error' as const,
      icon: 'warning' as const,
    }))
    .with('unknown', () => ({
      label: 'Delivery not confirmed',
      detail:
        'This message may already have arrived. Check WhatsApp before sending it again.',
      tone: 'uncertain' as const,
      icon: 'warning' as const,
    }))
    .exhaustive();
}

/** States a person must look at: never retried automatically. */
export function needsAttention(state: DeliveryState): boolean {
  return state === 'failed' || state === 'unknown';
}

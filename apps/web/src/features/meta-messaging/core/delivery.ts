import { match } from 'ts-pattern';

export type MessagingProvider = 'whatsapp' | 'instagram';
export type DeliveryState =
  | 'pending'
  | 'sending'
  | 'accepted'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'unknown';

export const providerName = (provider: MessagingProvider) =>
  match(provider)
    .with('whatsapp', () => 'WhatsApp')
    .with('instagram', () => 'Instagram')
    .exhaustive();

/** Translate known failures; never expose a provider response or server detail. */
export function messagingError(
  code: string | null | undefined,
  provider: MessagingProvider
) {
  const name = providerName(provider);
  const value = (code ?? '').toLowerCase();
  if (value === 'send_expired')
    return 'This reply waited for 10 minutes and was not sent. Edit and retry when you’re ready.';
  const number = value.match(/^(?:provider_error_)?(\d+)$/)?.[1];
  if (value.includes('not configured') || value.includes('configuration'))
    return `${name} messaging isn’t set up yet. Ask your Macro administrator to complete setup.`;
  if (
    /meta has not granted|api access blocked/.test(value) ||
    number === '10' ||
    number === '200'
  )
    return `Meta hasn’t granted this app access to ${name}. Ask a team admin to check the app’s status and messaging permissions in Meta.`;
  if (value.includes('coexistence'))
    return 'This number isn’t ready to connect while keeping the WhatsApp Business app. Check its connection eligibility in WhatsApp Manager.';
  if (/identity is already bound|conflict/.test(value))
    return 'The account or reply changed while you were sending. Refresh the conversation and review your draft.';
  if (number === '190' || /reconnect|revoked|disconnected/.test(value))
    return `This account needs to reconnect to ${name}. Ask a team admin to reconnect it in Settings.`;
  if (/permission|forbidden|not found/.test(value))
    return 'You no longer have access to send this reply. Ask a team admin to check your channel and account access.';
  if (
    number === '131047' ||
    /approved whatsapp template|template.*required/.test(value)
  )
    return 'WhatsApp’s reply window has closed. Use an approved template, or wait for the customer to message again.';
  if (value.includes('reply window'))
    return `The ${name} reply window has closed. Wait for the customer to message again.`;
  if (number === '131030' || value.includes('recipient allowlist'))
    return 'This number is not an approved test recipient. Add and verify it in Meta’s WhatsApp API Setup.';
  if (number === '131026')
    return 'WhatsApp could not deliver to this customer. Check their number and ask them to message the business account.';
  if (number === '131031')
    return 'WhatsApp has restricted this business account. A team admin needs to review it in WhatsApp Manager.';
  if (
    /rate_limit|temporarily unavailable/.test(value) ||
    number === '130429' ||
    number === '131048'
  )
    return `${name} is temporarily unable to send this reply. Try again in a little while.`;
  if (/template/.test(value) || number?.startsWith('132'))
    return 'This template could not be sent. Choose an approved template and check that every field is filled in.';
  if (
    /attachment|media|file/.test(value) ||
    number === '131052' ||
    number === '131053'
  )
    return 'This attachment could not be sent. Attach the file again and check its type and size.';
  if (/human support/.test(value))
    return 'This account cannot use the extended support window. Wait for a new customer message.';
  return `We couldn’t send this reply through ${name}. Your reply is saved here; review it and try again.`;
}

export type DeliveryPresentation = {
  label: string;
  detail?: string;
  tone: 'muted' | 'read' | 'error' | 'uncertain';
  icon: 'clock' | 'spinner' | 'check' | 'checks' | 'warning';
};

export function deliveryPresentation(
  state: DeliveryState,
  provider: MessagingProvider,
  error?: string | null
): DeliveryPresentation {
  const name = providerName(provider);
  return match(state)
    .with('pending', () => ({
      label: 'Queued',
      detail: error
        ? `${name} is busy. Macro will try again shortly.`
        : `Waiting to send through ${name}.`,
      tone: 'muted' as const,
      icon: 'clock' as const,
    }))
    .with('sending', () => ({
      label: 'Sending…',
      detail: `Sending through ${name}.`,
      tone: 'muted' as const,
      icon: 'spinner' as const,
    }))
    .with('accepted', () => ({
      label: `Sent to ${name}`,
      detail: `${name} accepted this reply. Delivery to the customer is not confirmed yet.`,
      tone: 'muted' as const,
      icon: 'check' as const,
    }))
    .with('sent', () => ({
      label: 'Sent',
      detail: `Sent through ${name}. Delivery is not confirmed yet.`,
      tone: 'muted' as const,
      icon: 'check' as const,
    }))
    .with('delivered', () => ({
      label: 'Delivered',
      detail: `${name} confirmed delivery to the customer.`,
      tone: 'muted' as const,
      icon: 'checks' as const,
    }))
    .with('read', () => ({
      label: 'Read',
      detail: `${name} confirmed the customer read this reply.`,
      tone: 'read' as const,
      icon: 'checks' as const,
    }))
    .with('failed', () => ({
      label: error === 'send_expired' ? 'Not sent' : 'Couldn’t deliver',
      detail: messagingError(error, provider),
      tone: 'error' as const,
      icon: 'warning' as const,
    }))
    .with('unknown', () => ({
      label: 'Delivery not confirmed',
      detail: `Your reply may have arrived. Check ${name} before sending it again.`,
      tone: 'uncertain' as const,
      icon: 'warning' as const,
    }))
    .exhaustive();
}

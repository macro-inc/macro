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
  provider: MessagingProvider,
  operation: 'reply' | 'connection' = 'reply'
) {
  const name = providerName(provider);
  const value = (code ?? '').toLowerCase();
  if (value === 'signup_cancelled')
    return 'Connection canceled. You can try again whenever you’re ready.';
  if (value === 'signup_unavailable')
    return 'Meta signup could not load. Check your network and try again.';
  if (value === 'signup_timeout')
    return 'Meta signup timed out. Start the connection again.';
  if (value === 'signup_denied')
    return 'Messaging access was not granted. Approve the requested access in Meta to connect this account.';
  if (value === 'signup_failed')
    return 'Meta could not finish signup. Review the account in Meta and try again.';
  if (value === 'send_expired')
    return 'This reply waited for 10 minutes and was not sent. Edit and retry when you’re ready.';
  const number = value.match(/^(?:provider_error_)?(\d+)$/)?.[1];
  if (value === 'configuration_required')
    return `${name} messaging isn’t set up yet. Ask your Macro administrator to complete setup.`;
  if (value === 'meta_access_required' || number === '10' || number === '200')
    return `Meta hasn’t granted this app access to ${name}. Ask a team admin to check the app’s status and messaging permissions in Meta.`;
  if (value === 'phone_selection_required')
    return 'Select one verified phone number in Meta and try connecting again.';
  if (value === 'whatsapp_mode_mismatch')
    return 'This number does not match the selected setup. Choose Business app for coexistence or Platform for a Cloud API number without the app.';
  if (['conflict', 'identity_conflict'].includes(value))
    return operation === 'connection'
      ? 'The account connection changed. Refresh Settings and reconnect the account.'
      : 'The account or reply changed while you were sending. Refresh the conversation and review your draft.';
  if (number === '190' || value === 'disconnected')
    return `This account needs to reconnect to ${name}. Ask the person who connected it or a team admin to reconnect it in Settings.`;
  if (['forbidden', 'not_found'].includes(value))
    return operation === 'connection'
      ? 'You no longer have permission to manage this account. Ask its connector or a team admin to check access.'
      : 'You no longer have access to send this reply. Ask a team admin to check your channel and account access.';
  if (number === '131020')
    return 'No one has joined yet — share the invite link.';
  if (value === 'group_read_only') return 'This WhatsApp group is read-only.';
  if (value === 'group_ineligible')
    return 'WhatsApp groups require an eligible Official Business Account and group webhook subscriptions.';
  if (value === 'group_unconfirmed')
    return 'Could not confirm the WhatsApp operation. You can deliberately retry.';
  if (number === '131047' || value === 'template_required')
    return 'WhatsApp’s reply window has closed. Use an approved template, or wait for the customer to message again.';
  if (value === 'reply_window_closed')
    return `The ${name} reply window has closed. Wait for the customer to message again.`;
  if (number === '131062')
    return 'Meta does not support this message for a business-scoped recipient. Check the account and message type in Meta before retrying.';
  if (number === '131030' || value === 'recipient_not_allowed')
    return 'This number is not an approved test recipient. Add and verify it in Meta’s WhatsApp API Setup.';
  if (number === '131026')
    return 'WhatsApp could not deliver to this customer. Check their number and ask them to message the business account.';
  if (number === '131031')
    return 'WhatsApp has restricted this business account. A team admin needs to review it in WhatsApp Manager.';
  if (
    ['rate_limited', 'temporarily_unavailable'].includes(value) ||
    number === '130429' ||
    number === '131048'
  )
    return `${name} is temporarily unable to send this reply. Try again in a little while.`;
  if (value === 'invalid_template' || number?.startsWith('132'))
    return 'This template could not be sent. Choose an approved template and check that every field is filled in.';
  if (
    value === 'invalid_attachment' ||
    number === '131052' ||
    number === '131053'
  )
    return 'This attachment could not be sent. Attach the file again and check its type and size.';
  if (value === 'human_support_required')
    return 'This account cannot use the extended support window. Wait for a new customer message.';
  if (operation === 'connection')
    return `We couldn’t connect this ${name} account. Check its status in Meta and try again.`;
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

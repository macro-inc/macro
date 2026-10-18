import { match } from 'ts-pattern';
import { type MessagingProvider, providerName } from './delivery';

/** Account recovery is separate from reply errors: reconnect cannot fix every Meta failure. */
export function accountHealthMessage(
  status: 'connecting' | 'connected' | 'disconnected' | 'revoked' | 'error',
  code: string | null | undefined,
  provider: MessagingProvider
): string | undefined {
  if (status === 'disconnected' || !code) return undefined;
  const authorization = `${providerName(provider)} authorization expired or was revoked. Reconnect this account.`;
  return match(code)
    .with(
      'registration_required',
      () =>
        'Enter the six-digit WhatsApp PIN to register this Platform number. Your account authorization is saved.'
    )
    .with(
      'registration_unavailable',
      () =>
        'Meta has not confirmed that this number can be registered. Check its status in WhatsApp Manager, then check registration again.'
    )
    .with(
      'registration_unconfirmed',
      () =>
        'Meta has not confirmed registration yet. Check registration before trying again; Macro will not repeat an uncertain request.'
    )
    .with(
      'registration_pin_incorrect',
      () =>
        'The WhatsApp PIN was incorrect. Re-enter the correct six-digit PIN. Your account authorization is saved.'
    )
    .with(
      'registration_pin_attempts_exceeded',
      () =>
        'Meta has blocked further PIN attempts. Follow the PIN recovery instructions in WhatsApp Manager before trying again.'
    )
    .with(
      'registration_rate_limited',
      () =>
        'Meta has reached its registration limit. Wait 72 hours before another attempt; you can still check whether registration completed.'
    )
    .with(
      'registration_rejected',
      () =>
        'Meta rejected registration. Check the number’s verification and two-step PIN in WhatsApp Manager.'
    )
    .with('meta_authorization_expired_or_revoked', () => authorization)
    .with(
      'meta_access_required',
      () =>
        'Meta is blocking this app’s access. Complete any account confirmation and check messaging permissions in Meta, then reconnect in Settings.'
    )
    .with(
      'connecting_member_access_lost',
      () =>
        'The person who connected this account is no longer a team member. A current team admin needs to reconnect it. Existing conversation and file access stays unchanged.'
    )
    .with(
      'connection_temporarily_unavailable',
      () => 'We couldn’t check this connection. Macro will retry automatically.'
    )
    .with(
      'connection_configuration_required',
      () => 'Ask your Macro administrator to finish messaging setup.'
    )
    .with(
      'provider_connection_rejected',
      () =>
        'Meta couldn’t confirm this connection. Check the account’s status in Meta, then reconnect.'
    )
    .otherwise(() =>
      status === 'revoked'
        ? authorization
        : 'We couldn’t verify this connection. Check the account’s status in Meta; reconnect if its authorization needs renewing.'
    );
}

export function disconnectMessage(result: {
  remote_unsubscribed: boolean;
  shared_subscription_kept: boolean;
}) {
  if (result.shared_subscription_kept)
    return 'Disconnected. Other numbers using this WhatsApp Business Account stay connected. Existing channels keep their content and permissions.';
  return result.remote_unsubscribed
    ? 'Disconnected. Existing channels keep their content and permissions.'
    : 'Disconnected in Macro. Meta did not confirm subscription removal; review the connected app in your business account.';
}

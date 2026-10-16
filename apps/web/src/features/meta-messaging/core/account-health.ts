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
    .with('meta_authorization_expired_or_revoked', () => authorization)
    .with(
      'meta_access_required',
      () =>
        'Meta is blocking this app’s access. Complete any account confirmation and check messaging permissions in Meta, then reconnect in Settings.'
    )
    .with(
      'connecting_admin_access_lost',
      () =>
        'The person who connected this account no longer has team admin access. A current team admin needs to reconnect it.'
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

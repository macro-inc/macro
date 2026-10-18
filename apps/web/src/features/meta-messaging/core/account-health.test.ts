import { describe, expect, it } from 'vitest';
import { accountHealthMessage, disconnectMessage } from './account-health';

describe('account health and disconnect recovery', () => {
  it('distinguishes expired authorization, blocked Meta access, and connector membership', () => {
    expect(
      accountHealthMessage(
        'revoked',
        'meta_authorization_expired_or_revoked',
        'whatsapp'
      )
    ).toContain('authorization expired');
    expect(
      accountHealthMessage('error', 'meta_access_required', 'instagram')
    ).toContain('account confirmation');
    expect(
      accountHealthMessage(
        'revoked',
        'connecting_member_access_lost',
        'instagram'
      )
    ).toContain('no longer a team member');
  });
  it('does not ask for a fresh login for a temporary outage', () => {
    const message = accountHealthMessage(
      'error',
      'connection_temporarily_unavailable',
      'instagram'
    );
    expect(message).toContain('retry automatically');
    expect(message?.toLowerCase()).not.toContain('reconnect');
  });
  it('supports legacy errors without displaying stale errors after disconnection', () => {
    expect(
      accountHealthMessage(
        'revoked',
        'connection_maintenance_failed_reconnect_if_access_revoked',
        'whatsapp'
      )
    ).toContain('authorization expired');
    expect(
      accountHealthMessage('disconnected', 'meta_access_required', 'instagram')
    ).toBeUndefined();
    expect(
      accountHealthMessage(
        'error',
        'unexpected private provider detail',
        'instagram'
      )
    ).not.toContain('private provider detail');
  });
  it('explains a preserved shared subscription as success', () => {
    const result = disconnectMessage({
      remote_unsubscribed: false,
      shared_subscription_kept: true,
    });
    expect(result).toContain('Other numbers');
    expect(result).not.toContain('did not confirm');
    expect(
      disconnectMessage({
        remote_unsubscribed: false,
        shared_subscription_kept: false,
      })
    ).toContain('did not confirm');
  });
});

import type { AccountManagerGrant as AccountManagerGrantRecord } from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { User } from '../users/user';

/** A request for an agent account to manage a person's account, and what became of it. */
export class AccountManagerGrant extends MacroEntity<AccountManagerGrantRecord> {
  /** Construct a lazy grant handle. */
  static byId(client: MacroClient, id: string): AccountManagerGrant {
    return new AccountManagerGrant(client, id);
  }

  /** Seed from a fetched grant. */
  static from(
    client: MacroClient,
    record: AccountManagerGrantRecord,
  ): AccountManagerGrant {
    return new AccountManagerGrant(client, record.id, record);
  }

  protected async fetch(): Promise<AccountManagerGrantRecord> {
    return unwrap(
      await this.client.storage.getAccountManagerGrant({
        path: { id: this.id },
      }),
    );
  }

  /** Where the grant is: `pending`, `approved`, `active`, `declined`, `revoked`, or `expired`. */
  readonly status = this.field('status');

  /** The side that asked: `managed` or `manager`. */
  readonly requestedBy = this.field('requestedBy');

  /** When the request was made. */
  readonly createdAt = this.field('createdAt');

  /** When the pending request or unclaimed approval stops being usable. */
  readonly expiresAt = this.field('expiresAt');

  /** When the manager claimed the token. */
  readonly claimedAt = this.field('claimedAt');

  /** When the token was last used, to the minute. */
  readonly lastUsedAt = this.field('lastUsedAt');

  /**
   * The account being managed.
   *
   * @readonly
   */
  async managed(): Promise<User> {
    return User.byId(this.client, (await this.detail.get()).managedUserId);
  }

  /**
   * The agent account doing the managing.
   *
   * @readonly
   */
  async manager(): Promise<User> {
    return User.byId(this.client, (await this.detail.get()).managerUserId);
  }

  /**
   * Approve a request you didn't make. Only the side that didn't ask can.
   *
   * @destructive
   */
  async approve(): Promise<void> {
    await this.mutate((c) =>
      c.storage.respondToAccountManagerRequest({
        path: { id: this.id },
        body: { decision: 'approve' },
      }),
    );
  }

  /**
   * Decline a request you didn't make. Only the side that didn't ask can.
   *
   * @destructive
   */
  async decline(): Promise<void> {
    await this.mutate((c) =>
      c.storage.respondToAccountManagerRequest({
        path: { id: this.id },
        body: { decision: 'decline' },
      }),
    );
  }

  /**
   * Get the token for the managed account. Only the manager can, and only once:
   * save it now. Use it as the SDK's `token` to act as the managed account.
   *
   * @destructive
   */
  async claimToken(): Promise<string> {
    const claimed = await this.mutate((c) =>
      c.storage.claimAccountManagerToken({ path: { id: this.id } }),
    );
    return claimed.token;
  }

  /**
   * End the grant, stopping its token immediately. Either side can.
   *
   * @destructive
   * @idempotent
   */
  async revoke(): Promise<void> {
    await this.mutate((c) =>
      c.storage.revokeAccountManagerGrant({ path: { id: this.id } }),
    );
  }
}

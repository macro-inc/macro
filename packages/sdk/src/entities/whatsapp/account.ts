import type { WhatsAppAccount as WhatsAppAccountRecord } from '../../../generated/storage/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { User } from '../users/user';

/** The current user's WhatsApp account, connected through the Macro app. */
export class WhatsAppAccount extends MacroEntity<WhatsAppAccountRecord> {
  /** Reference an account; reads still enforce the authenticated owner's scope. */
  static byId(client: MacroClient, id: string): WhatsAppAccount {
    return new WhatsAppAccount(client, id);
  }

  /** Seed an account handle from an API record. */
  static from(
    client: MacroClient,
    record: WhatsAppAccountRecord,
  ): WhatsAppAccount {
    return new WhatsAppAccount(client, record.id, record);
  }

  protected async fetch(): Promise<WhatsAppAccountRecord> {
    const { account } = unwrap(await this.client.storage.whatsappAccount());
    if (account?.id !== this.id) {
      throw new MacroNotFoundError('WhatsApp account is not available');
    }
    return account;
  }

  /** Account connection state; call refresh before polling it again. */
  readonly state = this.field('state');

  /** Verified remote identity, absent until pairing succeeds. */
  readonly identity = this.field('identityJid');

  /** The Macro user who owns this account. */
  readonly owner = this.mappedField('userId', (id) =>
    User.byId(this.client, id),
  );

  /** Discard cached connection state and load its current value. */
  async refresh(): Promise<this> {
    this.detail.clear();
    await this.detail.get();
    return this;
  }
}

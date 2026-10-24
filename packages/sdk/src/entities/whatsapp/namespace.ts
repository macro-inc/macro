import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { WhatsAppAccount } from './account';
import { WhatsAppGroup } from './group';
import { WhatsAppRemoteGroup } from './remote-group';

/** Operate on an account already paired through the Macro app. */
export class WhatsAppNamespace {
  /** Bind existing-account operations to this authenticated client. */
  constructor(private readonly client: MacroClient) {}

  /** Current owner's account, or undefined when no account has been connected. */
  async account(): Promise<WhatsAppAccount | undefined> {
    const { account } = unwrap(await this.client.storage.linkedAccount());
    return account ? WhatsAppAccount.from(this.client, account) : undefined;
  }

  /** Adopted groups shared with the caller, including without WhatsApp. */
  async groups(): Promise<WhatsAppGroup[]> {
    return unwrap(await this.client.storage.whatsappGroups()).map((record) =>
      WhatsAppGroup.byId(this.client, record.id),
    );
  }

  /** Groups discoverable through the caller's own connected account. */
  async remoteGroups(): Promise<WhatsAppRemoteGroup[]> {
    return unwrap(await this.client.storage.linkedGroups()).map((record) =>
      WhatsAppRemoteGroup.from(this.client, record),
    );
  }

  /** Reference an adopted entity without fetching it. */
  byId(id: string): WhatsAppGroup {
    return WhatsAppGroup.byId(this.client, id);
  }
}

import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { WhatsAppAccount } from './account';
import { WhatsAppChat } from './chat';

/**
 * The current user's WhatsApp account, paired through the Macro app, and its
 * chat list. Added chats are external chats: read and send in them through
 * `macro.externalChats`.
 */
export class WhatsAppNamespace {
  /** Bind existing-account operations to this authenticated client. */
  constructor(private readonly client: MacroClient) {}

  /** Current owner's account, or undefined when no account has been connected. */
  async account(): Promise<WhatsAppAccount | undefined> {
    const { account } = unwrap(await this.client.storage.whatsappAccount());
    return account ? WhatsAppAccount.from(this.client, account) : undefined;
  }

  /**
   * The caller's WhatsApp chat list (groups and direct chats), newest
   * activity first: each chat says whether it is added, shared with the caller
   * or addable, and `chat.add()` adds it.
   */
  async chats(): Promise<WhatsAppChat[]> {
    return unwrap(await this.client.storage.whatsappChats()).chats.map(
      (record) => WhatsAppChat.from(this.client, record),
    );
  }
}

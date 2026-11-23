import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { ExternalChat } from './chat';

/**
 * Chats from external messaging providers (WhatsApp today) that someone added
 * to Macro: read, share and send in them. Find and add a provider's chats
 * through its own namespace, such as `macro.whatsapp.chats()`.
 *
 * @routing Use when reading, sharing or sending in an external chat, such as a WhatsApp chat, already added to Macro; not Macro channels, or finding chats to add (`macro.whatsapp`).
 */
export class ExternalChatsNamespace {
  /** Bind external chat operations to this authenticated client. */
  constructor(private readonly client: MacroClient) {}

  /**
   * Added chats the caller can view, including without a provider account of their own.
   *
   * @readonly
   */
  async list(): Promise<ExternalChat[]> {
    return unwrap(await this.client.storage.externalChats()).map((record) =>
      ExternalChat.byId(this.client, record.id),
    );
  }

  /** Reference an added chat without fetching it. */
  byId(id: string): ExternalChat {
    return ExternalChat.byId(this.client, id);
  }
}

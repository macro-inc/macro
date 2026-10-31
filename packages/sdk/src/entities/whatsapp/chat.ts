import type {
  ExternalChatCommunity,
  WhatsAppChat as WhatsAppChatRecord,
} from '../../../generated/storage/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { ExternalChat } from '../external-chat/chat';

/** The WhatsApp community a group belongs to. */
export type WhatsAppCommunity = {
  /** The community itself, as a chat of the list (it can't be added). */
  chat: WhatsAppChat;
  /** The community's name. */
  name: string;
  /** This group is the community's announcement group. */
  announcements: boolean;
};

/** A community reference as a handle on the community's own chat. */
export function communityOf(
  client: MacroClient,
  record: ExternalChatCommunity,
): WhatsAppCommunity {
  return {
    chat: WhatsAppChat.byId(client, record.id),
    name: record.name,
    announcements: record.announcements,
  };
}

/** One chat of the current user's WhatsApp chat list: a group or a direct chat. */
export class WhatsAppChat extends MacroEntity<WhatsAppChatRecord> {
  /** Reference a chat by its WhatsApp JID. */
  static byId(client: MacroClient, id: string): WhatsAppChat {
    return new WhatsAppChat(client, id);
  }

  /** Seed a chat handle from the chat list. */
  static from(client: MacroClient, record: WhatsAppChatRecord): WhatsAppChat {
    return new WhatsAppChat(client, record.jid, record);
  }

  protected async fetch(): Promise<WhatsAppChatRecord> {
    const { chats } = unwrap(await this.client.storage.whatsappChats());
    const chat = chats.find((record) => record.jid === this.id);
    if (!chat) throw new MacroNotFoundError('WhatsApp chat is not available');
    return chat;
  }

  /** `group` or `direct`. */
  readonly kind = this.field('kind');

  /** Group subject (or member names), or the other person's name or number. */
  readonly name = this.field('name');

  /** The other person's phone number (`+<digits>`) of a direct chat, when known. */
  readonly phoneNumber = this.field('phoneNumber');

  /** Newest activity WhatsApp reported; unknown for saved contacts never written to. */
  readonly lastActivityAt = this.field('lastActivityAt');

  /** Archived in WhatsApp. */
  readonly archived = this.field('archived');

  /** Pinned in WhatsApp. */
  readonly pinned = this.field('pinned');

  /** Whether adding it to Macro works now. */
  readonly canAdd = this.field('canAdd');

  /** Why it can't be added (`not_in_group`, `community`, `own_chat`, `not_in_chat_list`), when it is neither added, shared nor addable. */
  readonly cannotAddReason = this.field('cannotAddReason');

  /** The WhatsApp community a group belongs to, if any: the community's own chat, its name, and whether this is its announcement group. */
  readonly community = this.mappedField('community', (record) =>
    record ? communityOf(this.client, record) : undefined,
  );

  /** The current user's own external chat for this chat, once added. */
  readonly added = this.mappedField('added', (record) =>
    record ? ExternalChat.byId(this.client, record.id) : undefined,
  );

  /** Someone else's external chat for this chat, shared with the current user. */
  readonly shared = this.mappedField('shared', (record) =>
    record ? ExternalChat.byId(this.client, record.id) : undefined,
  );

  /**
   * Add the chat (a group or a direct chat) to Macro as the current user's
   * own external chat; its earlier messages are imported from the phone.
   * Adding it again returns the same chat. Only the owner sends in a direct
   * chat.
   */
  async add(): Promise<ExternalChat> {
    const kind = await this.kind();
    const result = await this.mutate((client) =>
      client.storage.externalChatAdd({
        body: { provider: 'whatsapp', remoteId: this.id, kind },
      }),
    );
    return ExternalChat.byId(this.client, result.chatId);
  }

  /** Reload the chat's list entry. */
  async refresh(): Promise<this> {
    this.detail.clear();
    await this.detail.get();
    return this;
  }
}

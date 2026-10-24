import type { LinkedChat } from '../../../generated/storage/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { WhatsAppGroup } from './group';

/** One chat of the current user's WhatsApp chat list: a group or a direct chat. */
export class WhatsAppChat extends MacroEntity<LinkedChat> {
  /** Reference a chat by its WhatsApp JID. */
  static byId(client: MacroClient, id: string): WhatsAppChat {
    return new WhatsAppChat(client, id);
  }

  /** Seed a chat handle from the chat list. */
  static from(client: MacroClient, record: LinkedChat): WhatsAppChat {
    return new WhatsAppChat(client, record.jid, record);
  }

  protected async fetch(): Promise<LinkedChat> {
    const { chats } = unwrap(await this.client.storage.linkedChats());
    const chat = chats.find((record) => record.jid === this.id);
    if (!chat) throw new MacroNotFoundError('WhatsApp chat is not available');
    return chat;
  }

  /** `group` or `direct`. */
  readonly kind = this.field('kind');

  /** Group subject (or member names), or the other person's name or number. */
  readonly name = this.field('name');

  /** Newest activity WhatsApp reported, when known. */
  readonly lastActivityAt = this.field('last_activity_at');

  /** Archived in WhatsApp. */
  readonly archived = this.field('archived');

  /** Pinned in WhatsApp. */
  readonly pinned = this.field('pinned');

  /** Whether adding it to Macro works now. */
  readonly canAdd = this.field('can_add');

  /** Why it can't be added, when it is neither added, shared nor addable. */
  readonly cannotAddReason = this.field('cannot_add_reason');

  /** The current user's own Macro group for this chat, once added. */
  readonly group = this.mappedField('group', (record) =>
    record ? WhatsAppGroup.byId(this.client, record.id) : undefined,
  );

  /** Someone else's Macro group for this chat, shared with the current user. */
  readonly shared = this.mappedField('shared', (record) =>
    record ? WhatsAppGroup.byId(this.client, record.id) : undefined,
  );

  /**
   * Add a group chat to Macro as the current user's own group; its earlier
   * messages are imported from the phone. Adding it again returns the same
   * group. Direct chats can't be added yet.
   */
  async adopt(): Promise<WhatsAppGroup> {
    const result = await this.mutate((client) =>
      client.storage.linkedAdopt({ body: { group_jid: this.id } }),
    );
    return WhatsAppGroup.byId(this.client, result.group_id);
  }

  /** Reload the chat's list entry. */
  async refresh(): Promise<this> {
    this.detail.clear();
    await this.detail.get();
    return this;
  }
}

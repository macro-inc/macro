import type { ExternalChatParticipant as ExternalChatParticipantRecord } from '../../../generated/storage/types.gen';
import type { ExternalChat } from './chat';

/** Someone in an added external chat, from its members; mention them in a text reply. */
export class ExternalChatParticipant {
  private constructor(
    /** The chat whose members list them. */
    readonly chat: ExternalChat,
    /** Their provider id (a WhatsApp JID): correlation data, not a Macro user. */
    readonly id: string,
    private readonly record?: ExternalChatParticipantRecord,
  ) {}

  /** Reference a participant of a chat by provider id. */
  static byId(chat: ExternalChat, id: string): ExternalChatParticipant {
    return new ExternalChatParticipant(chat, id);
  }

  /** Seed a participant from the chat's members. */
  static from(
    chat: ExternalChat,
    record: ExternalChatParticipantRecord,
  ): ExternalChatParticipant {
    return new ExternalChatParticipant(chat, record.jid, record);
  }

  /** Their provider display name, untrusted, when known. */
  get displayName(): string | undefined {
    return this.record?.displayName ?? undefined;
  }

  /** The digits a text reply writes as `@<digits>` to mention them. */
  get mentionToken(): string {
    return this.id.split('@')[0] ?? this.id;
  }

  /** Whether they administer the group, when read from its members. */
  get admin(): boolean | undefined {
    return this.record?.admin;
  }

  /** Serialize the participant reference without credentials. */
  toJSON() {
    return {
      id: this.id,
      chat: this.chat.id,
      displayName: this.displayName,
      admin: this.admin,
    };
  }
}

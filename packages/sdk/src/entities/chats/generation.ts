import type { ChatMessageWithAttachments } from '../../../generated/cognition/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { Chat } from './chat';

/** A background chat generation. The stream belongs to exactly one chat. */
export class ChatGeneration {
  private constructor(
    private readonly client: MacroClient,
    /** Parent chat. */
    readonly chat: Chat,
    /** Stream identity. */
    readonly id: string,
    /** AI response message for this generation. */
    readonly message: ChatMessage,
  ) {}

  /** Construct from a send receipt. */
  static byId(
    client: MacroClient,
    chat: Chat,
    id: string,
    message: ChatMessage,
  ): ChatGeneration {
    return new ChatGeneration(client, chat, id, message);
  }

  /** Request cancellation of this generation. */
  async stop(): Promise<void> {
    unwrap(
      await this.client.cognition.stopChatStream({
        body: { chat_id: this.chat.id, stream_id: this.id },
      }),
    );
  }

  /** Serialize scoped identity. */
  toJSON() {
    return { id: this.id, chatId: this.chat.id, messageId: this.message.id };
  }
}

/** A message scoped to an AI chat. */
export class ChatMessage extends MacroEntity<ChatMessageWithAttachments> {
  private constructor(
    client: MacroClient,
    /** Parent chat. */
    readonly chat: Chat,
    id: string,
  ) {
    super(client, id);
  }

  /** Construct a chat message handle. */
  static byId(client: MacroClient, chat: Chat, id: string): ChatMessage {
    return new ChatMessage(client, chat, id);
  }

  protected async fetch(): Promise<ChatMessageWithAttachments> {
    const message = unwrap(
      await this.client.cognition.getChat({ path: { chat_id: this.chat.id } }),
    ).chat.messages.find((m) => m.id === this.id);
    if (!message)
      throw new MacroNotFoundError(
        `Chat message ${this.id} is not yet available`,
      );
    return message;
  }

  /** The message's generated content. */
  readonly content = this.field('content');

  /** Role of the message author. */
  readonly role = this.field('role');

  /** Reload after a running generation changes or finishes. */
  async refresh(): Promise<void> {
    this.detail.clear();
    await this.detail.get();
  }

  /** Serialize scoped identity and any loaded message. */
  override toJSON() {
    return { ...super.toJSON(), chatId: this.chat.id };
  }
}

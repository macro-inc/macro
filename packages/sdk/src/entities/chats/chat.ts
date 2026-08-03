import type {
  GetChatHistoryHandlerResponses,
  GetChatResponses,
} from '../../../generated/cognition/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { PropertiedEntity } from '../entity';
import { Project } from '../projects/project';
import { entitySearch } from '../search';

type ChatDetail = GetChatResponses[200]['chat'];
type ChatHistory = GetChatHistoryHandlerResponses[200]['conversation'];

/** A Macro AI chat. */
export class Chat extends PropertiedEntity<ChatDetail> {
  /** Favorites identify chats as `chat`. */
  readonly entityType = 'chat';

  /** The properties service identifies chats as `CHAT`. */
  protected readonly propertyEntityType = 'CHAT';

  protected async fetch(): Promise<ChatDetail> {
    const { chat } = unwrap(
      await this.client.cognition.getChat({ path: { chat_id: this.id } }),
    );
    return chat;
  }

  /** A handle to a chat by id. Details load on first access. */
  static byId(client: MacroClient, id: string): Chat {
    return new Chat(client, id);
  }

  /** Create a chat, optionally named and attached to a project. */
  static async create(
    client: MacroClient,
    opts?: { name?: string; project?: Project },
  ): Promise<Chat> {
    const { id } = unwrap(
      await client.cognition.createChat({
        body: {
          name: opts?.name ?? null,
          projectId: opts?.project?.id ?? null,
        },
      }),
    );
    return new Chat(client, id);
  }

  /** The chat's display name. */
  readonly name = this.field('name');

  /** The model used to generate the chat (`provider/model` id), if set. */
  readonly model = this.field('model');

  /** The project this chat belongs to, if any. */
  readonly project = this.mappedField('projectId', (id) =>
    id ? Project.byId(this.client, id) : undefined,
  );

  /** When the chat was created. */
  readonly createdAt = this.field('createdAt');

  /** When the chat was last updated. */
  readonly updatedAt = this.field('updatedAt');

  /** The messages in the chat, with their attachments. */
  readonly messages = this.field('messages');

  /** Rename the chat. */
  async rename(name: string): Promise<void> {
    await this.mutate((c) =>
      c.cognition.patchChat({
        path: { chat_id: this.id },
        body: { name },
      }),
    );
  }

  /**
   * Delete the chat. Soft by default (reversible with {@link restore});
   * pass `permanent: true` to delete irreversibly.
   */
  async delete(opts?: { permanent?: boolean }): Promise<void> {
    await this.mutate((c) =>
      opts?.permanent
        ? c.cognition.permanentlyDeleteChat({ path: { chat_id: this.id } })
        : c.cognition.deleteChat({ path: { chat_id: this.id } }),
    );
  }

  /** Copy the chat, returning a handle to the new copy. */
  async copy(): Promise<Chat> {
    const { id } = await this.mutate((c) =>
      c.cognition.copyChat({ path: { chat_id: this.id } }),
    );
    return new Chat(this.client, id);
  }

  /** Restore a soft-deleted chat. */
  async restore(): Promise<void> {
    await this.mutate((c) =>
      c.cognition.revertDeleteChat({ path: { chat_id: this.id } }),
    );
  }

  /** The chat's conversation history: titled records of messages with attachment ids. */
  async history(): Promise<ChatHistory> {
    const { conversation } = unwrap(
      await this.client.cognition.getChatHistoryHandler({
        path: { chat_id: this.id },
      }),
    );
    return conversation;
  }

  /** The chat's URL in the Macro web app. */
  webUrl(): string {
    return `${this.client.webAppUrl}/app/chat/${this.id}`;
  }

  /** Search chats by name and content, most relevant first, auto-paginated. */
  static search = entitySearch({
    filters: { chat_filters: {} },
    type: 'chat',
    make: (client, hit) => new Chat(client, hit.chat_id),
  });
}

import type { MacroClient } from '../../utils/client';
import type { Project } from '../projects/project';
import type { SearchOpts } from '../search/options';
import { Chat } from './chat';

/**
 * The user's AI chats: earlier conversations with Macro's assistant, each
 * with its message history. Find one with {@link ChatNamespace.search},
 * `macro.search.all(query, {types: ['chat']})` or
 * `macro.workspace.list({includeTypes: ['ai_chat']})`, then read it with
 * `chat.history()`. Agent work and coding sessions are agent sessions, not
 * chats.
 *
 * @routing Use when reading or continuing one of the user's AI chats with Macro's assistant; not agent sessions or channels.
 */
export class ChatNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to an AI chat by id; read its messages with `history()`. */
  byId(id: string): Chat {
    return Chat.byId(this.client, id);
  }

  /**
   * Create an empty AI chat, optionally named and in a project.
   *
   * @write
   */
  create(opts?: { name?: string; project?: Project }): Promise<Chat> {
    return Chat.create(this.client, opts);
  }

  /**
   * Search AI chats by name and content, most relevant first, auto-paginated.
   *
   * @readonly
   */
  search(query: string, opts?: SearchOpts): AsyncGenerator<Chat> {
    return Chat.search(this.client, query, opts);
  }
}

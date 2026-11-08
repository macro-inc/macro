import type { MacroClient } from '../../utils/client';
import type { SearchOpts } from '../search/options';
import { Chat } from './chat';

/**
 * The user's AI chats: earlier conversations with Macro's assistant, each
 * with its message history. They are read-only; new conversations are agent
 * sessions. Find one with {@link ChatNamespace.search},
 * `macro.search.all(query, {types: ['chat']})` or
 * `macro.workspace.list({includeTypes: ['ai_chat']})`, then read it with
 * `chat.history()`. Agent work and coding sessions are agent sessions, not
 * chats.
 *
 * @routing Use when reading one of the user's earlier AI chats with Macro's assistant; not agent sessions or channels.
 */
export class ChatNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to an AI chat by id; read its messages with `history()`. */
  byId(id: string): Chat {
    return Chat.byId(this.client, id);
  }

  /** Search AI chats by name and content, most relevant first, auto-paginated. */
  search(query: string, opts?: SearchOpts): AsyncGenerator<Chat> {
    return Chat.search(this.client, query, opts);
  }
}

import type { MacroClient } from '../../utils/client';
import type { Project } from '../projects/project';
import type { SearchOpts } from '../search';
import { Chat } from './chat';

export class ChatNamespace {
  constructor(private readonly client: MacroClient) {}

  byId(id: string): Chat {
    return Chat.byId(this.client, id);
  }

  create(opts?: { name?: string; project?: Project }): Promise<Chat> {
    return Chat.create(this.client, opts);
  }

  search(query: string, opts?: SearchOpts): AsyncGenerator<Chat> {
    return Chat.search(this.client, query, opts);
  }
}

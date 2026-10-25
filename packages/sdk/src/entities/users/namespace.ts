import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { User } from './user';

export class UserNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to a user by id. */
  byId(id: string): User {
    return User.byId(this.client, id);
  }

  /** The current authenticated user. */
  me(): Promise<User> {
    return User.me(this.client);
  }

  /**
   * Find people in your existing Macro contacts by name or email, as in the
   * mention picker. This is not a global directory. Returns every matching
   * contact so callers can disambiguate; it never chooses a person for you.
   */
  async search(query: string): Promise<User[]> {
    const term = query.trim().toLocaleLowerCase();
    if (!term) throw new Error('A person search needs a name or email.');
    const response = await this.client.contacts.getContacts();
    // The contacts API represents an empty contact set with 404.
    if (response.response?.status === 404) return [];
    const { contacts } = unwrap(response);
    const ids = [...new Set(contacts)];
    const matches: User[] = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100);
      const { names } = unwrap(
        await this.client.auth.getUserNamesWithEmail({
          body: { user_ids: batch },
        }),
      );
      const byId = new Map(names.map((name) => [name.id, name]));
      for (const id of batch) {
        const entry = byId.get(id) ?? { id };
        const name = [entry.first_name, entry.last_name]
          .filter(Boolean)
          .join(' ');
        if (`${name} ${id}`.toLocaleLowerCase().includes(term))
          matches.push(User.fromName(this.client, entry));
      }
    }
    return matches;
  }
}

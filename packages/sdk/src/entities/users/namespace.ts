import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { type ProfilePicture, toProfilePicture } from './profile-picture';
import { User } from './user';

/**
 * @routing Use when looking up people or their profiles; not team membership, or changing the user's own profile (`macro.me`).
 */
export class UserNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to a user by id. */
  byId(id: string): User {
    return User.byId(this.client, id);
  }

  /**
   * The current authenticated user.
   *
   * @readonly
   */
  me(): Promise<User> {
    return User.me(this.client);
  }

  /**
   * Current profile pictures for several users in one request. Users without
   * a picture are absent from the map.
   *
   * @example
   * const pictures = await macro.users.profilePictures(teammates);
   * const mine = pictures.get(teammates[0]);
   *
   * @readonly
   */
  async profilePictures(users: User[]): Promise<Map<User, ProfilePicture>> {
    const result = new Map<User, ProfilePicture>();
    const ids = [...new Set(users.map((user) => user.id))];
    if (ids.length === 0) return result;
    const { pictures } = unwrap(
      await this.client.auth.postProfilePictures({
        body: { user_id_list: ids },
      }),
    );
    const byId = new Map(pictures.map((row) => [row.id, row]));
    for (const user of users) {
      const picture = toProfilePicture(this.client, byId.get(user.id));
      if (picture) result.set(user, picture);
    }
    return result;
  }

  /**
   * Find people in your existing Macro contacts by name or email, as in the
   * mention picker. This is not a global directory. Returns every matching
   * contact so callers can disambiguate; it never chooses a person for you.
   *
   * @readonly
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

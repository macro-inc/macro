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
   * Find people by name or email among your Macro contacts and your team, as
   * in the mention picker. Returns at most 20 people in one request, ranked
   * teammates first, then names or addresses that start with the query. This
   * is not a global directory, and it never chooses a person for you.
   *
   * @param query - A name or email, at least two characters; a shorter one
   *   finds nobody.
   *
   * @readonly
   */
  async search(query: string): Promise<User[]> {
    const term = query.trim();
    if (!term) throw new Error('A person search needs a name or email.');
    const { people } = unwrap(
      await this.client.contacts.searchPeople({ query: { query: term } }),
    );
    return people.map((person) =>
      User.fromName(this.client, {
        id: person.userId,
        first_name: person.name ?? null,
        last_name: null,
        is_agent: person.isAgent,
      }),
    );
  }
}

import type { ContactList } from '../../../generated/contacts/types.gen';
import { MacroError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import {
  type IterationOptions,
  iterate,
  paginate,
} from '../../utils/pagination';
import { type ProfilePicture, toProfilePicture } from './profile-picture';
import { User } from './user';

/**
 * One of your contacts lists, by key: `teammates` (your current team),
 * `interacted` (you share a channel, or a DM with a message), `invited`
 * (people you invited to Macro), `gmail` and `outlook` (people known through
 * a connected inbox of that provider).
 */
export type ContactListKey = ContactList;

const CONTACT_LISTS: readonly ContactListKey[] = [
  'teammates',
  'interacted',
  'invited',
  'gmail',
  'outlook',
];

/** How to page a contacts list's members. */
export interface ListMembersOptions extends IterationOptions {
  /** Members per request, 1 to 500; 100 when omitted. */
  pageSize?: number;
}

/**
 * @routing Use when looking up people, your teammates or contacts lists, or their profiles; not managing team membership, or changing the user's own profile (`macro.me`).
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

  /**
   * Your teammates: everyone on your current team except you, with names, in
   * email order. Empty when you have no team. Always current, since it is read
   * from the team roster. For their roles use `macro.teams.current()`.
   *
   * @example
   * const teammates = await macro.users.teammates();
   * const pictures = await macro.users.profilePictures(teammates);
   *
   * @readonly
   */
  async teammates(): Promise<User[]> {
    const teammates: User[] = [];
    for await (const user of this.inList('teammates', { pageSize: 500 }))
      teammates.push(user);
    return teammates;
  }

  /**
   * The members of one of your contacts lists, with names, in email order;
   * `maxItems` caps the total. Lists other than `teammates` are recorded as
   * people interact, so they may be incomplete until the list backfill has
   * run; `teammates` is always the current team. You are never in your own
   * lists. This reads the lists whichever directory the mention picker and
   * `search` use for you, so someone can be found by `search` without being
   * in a list yet.
   *
   * @param list - `teammates`, `interacted`, `invited`, `gmail` or `outlook`
   *   (see {@link ContactListKey}).
   *
   * @example
   * for await (const person of macro.users.inList('gmail', { maxItems: 50 })) {
   *   console.log(person.email(), await person.name());
   * }
   *
   * @readonly
   */
  inList(
    list: ContactListKey,
    options?: ListMembersOptions,
  ): AsyncGenerator<User> {
    if (!CONTACT_LISTS.includes(list))
      throw new MacroError(
        `users.inList: unknown list \`${list}\`; use one of ${CONTACT_LISTS.join(', ')}.`,
      );
    return iterate('users.inList', options, { pageSize: true }, () =>
      paginate<User>(async (cursor) => {
        const page = unwrap(
          await this.client.contacts.listContactListMembers({
            path: { list },
            query: { cursor, limit: options?.pageSize },
          }),
        );
        return {
          items: await User.named(this.client, page.members),
          nextCursor: page.nextCursor,
        };
      }),
    );
  }
}

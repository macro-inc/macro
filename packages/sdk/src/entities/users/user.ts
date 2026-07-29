import type { UserName } from '../../../generated/auth/types.gen';
import { type Mentionable, type MentionPart, wrapXml } from '../../mentions';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Channel } from '../channels/channel';
import { PropertiedEntity } from '../entity';

/**
 * A Macro user. Identity lives in the auth service, so details like the
 * display name are fetched on demand. Can be dropped into a {@link msg}
 * template to @-mention the user.
 */
export class User extends PropertiedEntity<UserName> implements Mentionable {
  /** Favorites identify users as `user`. */
  readonly entityType = 'user';

  /** The properties service identifies users as `USER`. */
  protected readonly propertyEntityType = 'USER';

  protected async fetch(): Promise<UserName> {
    const { names } = unwrap(
      await this.client.auth.getUserNamesWithEmail({
        body: { user_ids: [this.id] },
      }),
    );
    const entry = names.find((n: UserName) => n.id === this.id);
    if (!entry) throw new MacroNotFoundError(`user ${this.id} not found`);
    return entry;
  }

  /** A handle to a user by id. */
  static byId(client: MacroClient, id: string): User {
    return new User(client, id);
  }

  /** A handle to the current authenticated user. */
  static async me(client: MacroClient): Promise<User> {
    const { user_id } = unwrap(await client.auth.getUserInfo());
    return new User(client, user_id);
  }

  /**
   * This user's display name, fetched from the auth service (falling back to
   * your email contacts when the Macro profile has none).
   *
   * @returns The full name, or `undefined` if the user has no name on record.
   */
  async name(): Promise<string | undefined> {
    const entry = await this.detail.get();
    const full = [entry.first_name, entry.last_name].filter(Boolean).join(' ');
    return full || undefined;
  }

  /**
   * This user's email address. Macro user ids encode it as `macro|<email>`,
   * so this reads straight off the id — no auth-service endpoint returns
   * emails for arbitrary users.
   *
   * @returns The email, or `undefined` if the id is not email-derived.
   */
  email(): string | undefined {
    const email = this.id.startsWith('macro|') ? this.id.slice(6) : undefined;
    return email?.includes('@') ? email : undefined;
  }

  /**
   * Open (or create) your direct-message channel with this user.
   *
   * @returns The DM `Channel`.
   */
  dm(): Promise<Channel> {
    return Channel.dm(this.client, this);
  }

  toMention(): MentionPart {
    return {
      tag: wrapXml('m-user-mention', { userId: this.id }),
      mention: { entity_type: 'user', entity_id: this.id },
    };
  }
}

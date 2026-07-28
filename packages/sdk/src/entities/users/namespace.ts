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
}

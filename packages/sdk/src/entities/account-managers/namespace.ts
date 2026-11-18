import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { User } from '../users/user';
import { AccountManagerGrant } from './grant';

/** Account managers: an agent account's full access to a person's account. */
export class AccountManagerNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Construct a lazy grant handle. */
  byId(id: string): AccountManagerGrant {
    return AccountManagerGrant.byId(this.client, id);
  }

  /**
   * List the approved and active managers of the caller's account.
   *
   * @readonly
   */
  async list(): Promise<AccountManagerGrant[]> {
    return unwrap(await this.client.storage.listAccountManagers()).grants.map(
      (record) => AccountManagerGrant.from(this.client, record),
    );
  }

  /**
   * Ask to manage `user`'s account, in your DM. The caller must be an agent account and `user` a person.
   *
   * @write
   */
  async askToManage(user: User): Promise<AccountManagerGrant> {
    return this.request(user, 'manager');
  }

  /**
   * Ask `user`, an agent account, to manage the caller's account, in your DM. The caller must be a person.
   *
   * @write
   */
  async askToBeManagedBy(user: User): Promise<AccountManagerGrant> {
    return this.request(user, 'managed');
  }

  private async request(
    user: User,
    callerRole: 'managed' | 'manager',
  ): Promise<AccountManagerGrant> {
    const record = unwrap(
      await this.client.storage.requestAccountManager({
        body: { counterpartyId: user.id, callerRole },
      }),
    );
    return AccountManagerGrant.from(this.client, record);
  }
}

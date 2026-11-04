import type { Harness as HarnessRecord } from '../../../generated/storage/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Agent } from '../agents/agent';
import { MacroEntity } from '../entity';
import { EntityAccess, type AccessRequest } from '../sharing/access';
import { User } from '../users/user';

/** A registered host for agents: a teammate's computer running macrod. */
export class Harness extends MacroEntity<HarnessRecord> {
  /**
   * Access requests for this host. Asking for access works from any credential;
   * deciding who gets it takes the owner's own session, in the app.
   */
  readonly access = new EntityAccess(this.client, 'harness', this);

  /** Construct a lazy host handle. */
  static byId(client: MacroClient, id: string): Harness {
    return new Harness(client, id);
  }

  /** Seed from a listed host. */
  static from(client: MacroClient, record: HarnessRecord): Harness {
    return new Harness(client, record.id, record);
  }

  protected async fetch(): Promise<HarnessRecord> {
    const record = unwrap(await this.client.storage.listHarnessDirectory()).find(
      (h) => h.id === this.id,
    );
    if (!record)
      throw new MacroNotFoundError(`Harness ${this.id} is unavailable`);
    return record;
  }

  /** Display name. */
  readonly name = this.field('name');

  /** Whether the host is connected. */
  readonly connected = this.field('connected');

  /** Runtime kind. */
  readonly kind = this.field('kind');

  /** The person whose computer this is. */
  readonly owner = this.mappedField('owner', (owner) =>
    User.byId(this.client, owner.user_id),
  );

  /** What the caller may do with the host: `owner`, `use`, or `none`. */
  readonly callerAccess = this.field('access');

  /**
   * Ask the host's owner for access in the caller's name, and show them which
   * agent asked.
   *
   * Agents: call this only when the user asked for it or agreed after being
   * offered it, typically after `callerAccess()` was `none` or a prompt to an
   * agent on this host was refused; never request access on your own. It never
   * grants access: agents cannot approve requests or share a host, even one
   * their own user owns. Tell the user it is pending with `owner()`, and check
   * `callerAccess()` later.
   */
  async requestAccess(): Promise<AccessRequest> {
    return this.access.request('edit');
  }

  /** Agents living on the host, for callers who may use it. */
  async residents(): Promise<Agent[]> {
    return unwrap(
      await this.client.storage.listHarnessResidents({
        path: { harness_id: this.id },
      }),
    ).map((resident) => Agent.byId(this.client, resident.bot_id));
  }

  /** Remove the host. */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.storage.deleteHarness({ path: { harness_id: this.id } }),
    );
  }
}

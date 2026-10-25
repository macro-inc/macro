import type {
  CreateInitiativeRequest,
  InitiativeDetail,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { EntityAccess } from '../sharing/access';
import {
  type SharePermissionOptions,
  sharePermissionBody,
} from '../sharing/permissions';
import { Task } from '../tasks/task';
import { User } from '../users/user';

/** Initiative creation settings. */
export interface InitiativeOptions {
  /** Initiative name. */
  name: string;
  /** Collaborative description. */
  description?: string;
  /** Members assigned to this initiative. */
  members?: User[];
  /** Initial properties. */
  propertyValues?: CreateInitiativeRequest['propertyValues'];
  /** Whether the current team can access it. */
  shareWithTeam?: boolean;
}

/** A group of tasks and members working toward an outcome. */
export class Initiative extends MacroEntity<InitiativeDetail> {
  /** Access requests and direct user grants. */
  readonly access = new EntityAccess(this.client, 'initiative', this);

  /** Construct a lazy initiative handle. */
  static byId(client: MacroClient, id: string): Initiative {
    return new Initiative(client, id);
  }

  /** Seed from an initiative detail response. */
  static from(client: MacroClient, record: InitiativeDetail): Initiative {
    return new Initiative(client, record.id, record);
  }

  protected async fetch(): Promise<InitiativeDetail> {
    return unwrap(
      await this.client.storage.getInitiative({
        path: { initiative_id: this.id },
      }),
    );
  }

  /** Display name. */
  readonly name = this.field('name');

  /** Owner. */
  readonly owner = this.mappedField('ownerId', (id) =>
    User.byId(this.client, id),
  );

  /** Assigned members. */
  readonly members = this.mappedField('memberIds', (ids) =>
    ids.map((id) => User.byId(this.client, id)),
  );

  /** Tasks in this initiative. */
  readonly tasks = this.mappedField('taskIds', (ids) =>
    ids.map((id) => Task.byId(this.client, id)),
  );

  /** Current user's access. */
  readonly accessLevel = this.field('userAccessLevel');

  /** Sharing configuration. */
  readonly sharePermissions = this.field('sharePermission');

  /** Update the name, membership or sharing configuration. */
  async update(options: {
    name?: string;
    members?: User[];
    sharePermission?: SharePermissionOptions;
  }): Promise<void> {
    await this.mutate((c) =>
      c.storage.updateInitiative({
        path: { initiative_id: this.id },
        body: {
          name: options.name,
          memberIds: options.members?.map((u) => u.id),
          sharePermission: options.sharePermission
            ? sharePermissionBody(options.sharePermission)
            : undefined,
        },
      }),
    );
  }

  /** Delete this initiative. */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.storage.deleteInitiative({ path: { initiative_id: this.id } }),
    );
  }
}

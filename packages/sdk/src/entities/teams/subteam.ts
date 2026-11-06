import type {
  SubteamColor,
  SubteamJoinPolicy,
  Subteam as SubteamRecord,
  SubteamRole,
} from '../../../generated/auth/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { User } from '../users/user';

/** Someone on a subteam: the user and their role. */
export interface SubteamMembership {
  /** The member. */
  user: User;

  /** `manager` members edit the subteam and add people; `member`s belong. */
  role: SubteamRole;
}

/** Settings to change on a subteam. Omitted fields stay as they are. */
export interface SubteamChanges {
  /** The new name, 1 to 40 characters. */
  name?: string;

  /** The new description, at most 200 characters. */
  description?: string;

  /** The new color of the subteam's mark. */
  color?: SubteamColor;

  /** `open` lets anyone on the team join; `invite_only` needs a manager. */
  joinPolicy?: SubteamJoinPolicy;
}

/**
 * A subteam: a named group of people inside the caller's current team, such
 * as Engineering or Design. Subteams nest one level. Anyone on the team may
 * create one and manages what they create; a subteam's managers and the
 * team's admins may change it.
 */
export class Subteam extends MacroEntity<SubteamRecord> {
  /** A handle to a subteam by id. Details load on first access. */
  static byId(client: MacroClient, id: string): Subteam {
    return new Subteam(client, id);
  }

  /** Build a subteam from an already-fetched record (pre-seeded, no fetch). */
  static from(client: MacroClient, record: SubteamRecord): Subteam {
    return new Subteam(client, record.id, record);
  }

  protected async fetch(): Promise<SubteamRecord> {
    const { subteams } = unwrap(await this.client.auth.listSubteams());
    const subteam = subteams.find((candidate) => candidate.id === this.id);
    if (!subteam) throw new MacroNotFoundError(`subteam ${this.id} not found`);
    return subteam;
  }

  /** The subteam's name. */
  readonly name = this.field('name');

  /** What the subteam does; empty when unset. */
  readonly description = this.field('description');

  /** The color of the subteam's mark. */
  readonly color = this.field('color');

  /** Who may join without being added. */
  readonly joinPolicy = this.field('joinPolicy');

  /** When the subteam was created, as an ISO 8601 timestamp. */
  readonly createdAt = this.field('createdAt');

  /** The top-level subteam this one is nested in, if any. */
  readonly parent: () => Promise<Subteam | undefined> = this.mappedField(
    'parentId',
    (parentId): Subteam | undefined =>
      parentId ? Subteam.byId(this.client, parentId) : undefined,
  );

  /** The subteam's members, managers first. */
  readonly members = this.mappedField('members', (members) =>
    members.map(
      (member): SubteamMembership => ({
        user: User.byId(this.client, member.userId),
        role: member.role,
      }),
    ),
  );

  /** Change the subteam's name, description, color, or join policy. */
  async update(changes: SubteamChanges): Promise<this> {
    await this.mutate((client) =>
      client.auth.updateSubteam({
        path: { subteam_id: this.id },
        body: changes,
      }),
    );
    return this;
  }

  /**
   * Nest this subteam under a top-level subteam, or move it to the top level
   * with `null`. A subteam with subteams of its own stays at the top.
   * Requires managing both this subteam and the new parent.
   */
  async nestUnder(parent: Subteam | null): Promise<this> {
    await this.mutate((client) =>
      client.auth.nestSubteam({
        path: { subteam_id: this.id },
        body: { parentId: parent?.id ?? null },
      }),
    );
    return this;
  }

  /**
   * Add someone on the team to this subteam, or change their role. Managers
   * add anyone; anyone may add themselves to an open subteam as a member.
   */
  async addMember(user: User, role: SubteamRole = 'member'): Promise<this> {
    await this.mutate((client) =>
      client.auth.saveSubteamMember({
        path: { subteam_id: this.id, user_id: user.id },
        body: { role },
      }),
    );
    return this;
  }

  /** Remove someone from this subteam. Anyone may remove themselves. */
  async removeMember(user: User): Promise<this> {
    await this.mutate((client) =>
      client.auth.removeSubteamMember({
        path: { subteam_id: this.id, user_id: user.id },
      }),
    );
    return this;
  }

  /** Delete this subteam. Its members stay on the team; nested subteams move to the top. */
  async delete(): Promise<void> {
    unwrap(
      await this.client.auth.deleteSubteam({ path: { subteam_id: this.id } }),
    );
  }
}

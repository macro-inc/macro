import type {
  Team as TeamRecord,
  TeamRole,
} from '../../../generated/auth/types.gen';
import { MacroError, MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { User } from '../users/user';

/** A member of a team: the user and their role. */
export interface TeamMembership {
  /** The member. */
  user: User;
  /** Their role on the team. */
  role: TeamRole;
}

/**
 * A Macro team. A free-to-construct handle; the record loads lazily on first
 * field access, resolved from the caller's team memberships.
 */
export class Team extends MacroEntity<TeamRecord> {
  protected async fetch(): Promise<TeamRecord> {
    const teams = unwrap(await this.client.auth.getUserTeams());
    const team = teams.find((t) => t.id === this.id);
    if (!team) throw new MacroNotFoundError(`team ${this.id} not found`);
    return team;
  }

  /** A handle to a team by id. Details load on first access. */
  static byId(client: MacroClient, id: string): Team {
    return new Team(client, id);
  }

  /** The caller's current team. */
  static async current(client: MacroClient): Promise<Team> {
    const res = unwrap(await client.auth.getTeam());
    if (!res) throw new MacroNotFoundError('caller has no current team');
    return new Team(client, res.team.id, res.team);
  }

  /** The teams the caller belongs to. */
  static async list(client: MacroClient): Promise<Team[]> {
    const teams = unwrap(await client.auth.getUserTeams());
    return teams.map((t) => new Team(client, t.id, t));
  }

  /** The team's display name. */
  readonly name = this.field('name');

  /** The team's slug (its URL identifier). */
  readonly slug = this.field('slug');

  /** The user who owns the team. */
  readonly owner = this.mappedField('owner_id', (id) =>
    User.byId(this.client, id),
  );

  /**
   * The team's members, with their roles. The API only exposes members for
   * the caller's current team, so this rejects for any other team.
   */
  async members(): Promise<TeamMembership[]> {
    const res = unwrap(await this.client.auth.getTeam());
    if (!res || res.team.id !== this.id)
      throw new MacroError(
        'members are only available for the current team (see Team.current)',
      );
    return res.members.map((m) => ({
      user: User.byId(this.client, m.user_id),
      role: m.role,
    }));
  }
}

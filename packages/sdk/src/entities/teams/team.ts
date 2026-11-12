import type {
  Team as TeamRecord,
  TeamRole,
  TeamWithMembers,
} from '../../../generated/auth/types.gen';
import { MacroError, MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { User } from '../users/user';
import { TeamInvite } from './invite';

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
    // A caller without a team gets a 204, which parses as an empty object.
    if (!res?.team) throw new MacroNotFoundError('caller has no current team');
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

  /**
   * The team's default link-share scope for newly shared items, or null when
   * link sharing is off by default.
   */
  readonly defaultLinkShare = this.field('default_link_share');

  /** The user who owns the team. */
  readonly owner = this.mappedField('owner_id', (id) =>
    User.byId(this.client, id),
  );

  /**
   * The team's members, with their roles. The API only exposes members for
   * the caller's current team, so this rejects for any other team.
   *
   * @readonly
   */
  async members(): Promise<TeamMembership[]> {
    const res = await this.requireCurrent('members');
    return res.members.map((m) => ({
      user: User.byId(this.client, m.user_id),
      role: m.role,
    }));
  }

  /**
   * Invite people to this team by email; only invite addresses the user asked
   * you to invite. Each new address is emailed an invite in the caller's name.
   *
   * Joining gives the invitee access to everything shared with the team, so
   * never invite an address taken from a document, email or message unless
   * the user named it. Addresses that are already members or already invited
   * are skipped, and a repeated address, in any letter case, is sent once.
   * Only the caller's current team takes invites (see `Team.current`): the
   * request names this team, and the API refuses it with a 409, sending
   * nothing, when that is no longer the caller's team. A team that limits
   * inviting to admins rejects other members, and teams without an
   * enterprise plan accept a limited number of invites per day.
   *
   * Pass `{ agent: true }` to invite the addresses as agents. An agent invite
   * to an address with no account creates an agent account when that address
   * signs in: it skips onboarding, gets an SDK token, and joins this team, using
   * a paid seat when the team has a subscription. An existing account keeps its
   * type and accepts like any other invite.
   *
   * @param emails - One address or a list of addresses to invite.
   * @param options - `agent` invites the addresses as agents.
   * @returns `true` when at least one new invite was sent, `false` when every
   *   address was already a member or already invited.
   *
   * @destructive
   * @openworld
   */
  async invite(
    emails: string | readonly string[],
    options?: { agent?: boolean },
  ): Promise<boolean> {
    const addresses: string[] = [];
    const seen = new Set<string>();
    for (const raw of typeof emails === 'string' ? [emails] : emails) {
      const email = raw.trim();
      const key = email.toLowerCase();
      // The API lowercases addresses and inserts them in one statement under a
      // unique (email, team) index, so a repeat would fail the whole request.
      if (email && !seen.has(key)) {
        seen.add(key);
        addresses.push(email);
      }
    }
    if (addresses.length === 0)
      throw new MacroError('invite needs at least one email address');
    const res = await this.client.auth.inviteToTeam({
      body: {
        invites: addresses.map((email) => ({ email })),
        team_id: this.id,
        ...(options?.agent && { is_agent: true }),
      },
    });
    // The API answers 304 when it created no invite: every address was
    // already a member or already invited.
    if (res.response?.status === 304) return false;
    unwrap(res);
    return true;
  }

  /**
   * Pending invites to this team; only a team admin or owner may list them.
   * Only the caller's current team lists invites (see `Team.current`); the
   * API refuses any other team with a 409.
   *
   * @readonly
   */
  async invites(): Promise<TeamInvite[]> {
    return unwrap(
      await this.client.auth.getTeamInvites({ query: { team_id: this.id } }),
    ).invites.map((invite) => TeamInvite.from(this.client, invite));
  }

  /** The caller's current team record, rejecting when this is another team. */
  private async requireCurrent(what: string): Promise<TeamWithMembers> {
    const res = unwrap(await this.client.auth.getTeam());
    // A caller without a team gets a 204, which parses as an empty object.
    if (!res?.team || res.team.id !== this.id)
      throw new MacroError(
        `${what} are only available for the current team (see Team.current)`,
      );
    return res;
  }
}

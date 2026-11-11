import type { TeamInviteDetails } from '../../../generated/auth/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { User } from '../users/user';

/**
 * A pending invite to the caller's current team. Reading and revoking invites
 * requires a team admin or owner; `Team.invite` sends new ones.
 */
export class TeamInvite extends MacroEntity<TeamInviteDetails> {
  /** A handle to a pending team invite by id. Details load on first access. */
  static byId(client: MacroClient, id: string): TeamInvite {
    return new TeamInvite(client, id);
  }

  /** Build an invite from an already-fetched record (pre-seeded, no fetch). */
  static from(client: MacroClient, record: TeamInviteDetails): TeamInvite {
    return new TeamInvite(client, record.id, record);
  }

  protected async fetch(): Promise<TeamInviteDetails> {
    const invite = unwrap(await this.client.auth.getTeamInvites()).invites.find(
      (candidate) => candidate.id === this.id,
    );
    if (!invite)
      throw new MacroNotFoundError(`team invite ${this.id} not found`);
    return invite;
  }

  /** The invited email address. */
  readonly email = this.field('email');

  /** The role the invitee gets when they join. */
  readonly role = this.field('team_role');

  /** The member who sent the invite. */
  readonly invitedBy = this.mappedField('invited_by', (id) =>
    User.byId(this.client, id),
  );

  /** When the invite was created, as an ISO 8601 timestamp. */
  readonly createdAt = this.field('created_at');

  /** When the invite email was last sent, as an ISO 8601 timestamp. */
  readonly lastSentAt = this.field('last_sent_at');

  /**
   * Revoke this invite so it can no longer be accepted; only a team admin or
   * owner may revoke.
   *
   * @destructive
   * @idempotent
   */
  async revoke(): Promise<void> {
    await this.mutate((client) =>
      client.auth.deleteTeamInviteHandler({
        path: { team_invite_id: this.id },
      }),
    );
  }
}

import type { MacroClient } from '../../utils/client';
import { Team } from './team';

/**
 * @routing Use when managing teams and membership or inviting people to a team; not inviting people to Macro, which is referrals.
 */
export class TeamNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to a team by id. */
  byId(id: string): Team {
    return Team.byId(this.client, id);
  }

  /**
   * The caller's current team.
   *
   * @readonly
   */
  current(): Promise<Team> {
    return Team.current(this.client);
  }

  /**
   * The teams the caller belongs to.
   *
   * @readonly
   */
  list(): Promise<Team[]> {
    return Team.list(this.client);
  }
}

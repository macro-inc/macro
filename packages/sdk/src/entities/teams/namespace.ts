import type { MacroClient } from '../../utils/client';
import { Team } from './team';

export class TeamNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to a team by id. */
  byId(id: string): Team {
    return Team.byId(this.client, id);
  }

  /** The caller's current team. */
  current(): Promise<Team> {
    return Team.current(this.client);
  }

  /** The teams the caller belongs to. */
  list(): Promise<Team[]> {
    return Team.list(this.client);
  }
}

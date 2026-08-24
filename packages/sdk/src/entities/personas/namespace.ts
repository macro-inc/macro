import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { Team } from '../teams/team';
import { Persona, type PersonaAgent } from './persona';

export class PersonaNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to a persona by bot id. Details load on first access. */
  byId(id: string): Persona {
    return Persona.byId(this.client, id);
  }

  /** Look a persona up by its `@` handle. */
  byHandle(handle: string): Promise<Persona> {
    return Persona.byHandle(this.client, handle);
  }

  /** Every persona the caller's teams own. */
  list(): Promise<Persona[]> {
    return Persona.list(this.client);
  }

  /** Create a persona in a team the caller administers. */
  create(opts: {
    team: Team;
    name: string;
    handle: string;
    description?: string;
    avatarUrl?: string;
    agent?: PersonaAgent;
  }): Promise<Persona> {
    return Persona.create(this.client, opts);
  }

  /**
   * Every bot the caller can `@`-mention: their teams' personas plus the
   * ownerless first-party agents.
   *
   * Broader than {@link list}, which covers only the personas the caller's
   * teams own — a built-in agent is mentionable but belongs to no team and so
   * cannot be edited.
   */
  async mentionable(): Promise<Persona[]> {
    const bots = unwrap(await this.client.storage.listMentionableBots());
    return bots.map((bot) => Persona.byId(this.client, bot.id));
  }
}

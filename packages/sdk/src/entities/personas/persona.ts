import type {
  AgentModel,
  Harness,
  Persona as PersonaRecord,
} from '../../../generated/storage/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { Team } from '../teams/team';

/** What a persona runs: its harness, model, instructions and repository. */
export interface PersonaAgent {
  /** Harness the sandbox runs. */
  harness: Harness;
  /** Model the harness is launched with. */
  model: AgentModel;
  /** Markdown instructions prepended to every session, if any. */
  instructions?: string;
  /** Repository cloned into the workspace; absent means no checkout. */
  repoUrl?: string;
}

/** Fields a persona can be created or updated with. */
export interface PersonaFields {
  /** Display name. */
  name?: string;
  /** Handle typed after the `@`. */
  handle?: string;
  /** Short description shown alongside the name. */
  description?: string;
  /** Avatar URL. */
  avatarUrl?: string;
  /** What it runs. Replaces the current configuration wholesale. */
  agent?: PersonaAgent;
}

function toAgent(record: PersonaRecord): PersonaAgent {
  return {
    harness: record.agent.harness,
    model: record.agent.model,
    instructions: record.agent.system_prompt ?? undefined,
    repoUrl: record.agent.repo_url ?? undefined,
  };
}

function agentBody(agent: PersonaAgent) {
  return {
    harness: agent.harness,
    model: agent.model,
    system_prompt: agent.instructions ?? null,
    repo_url: agent.repoUrl ?? null,
  };
}

/**
 * A persona: a named, team-owned agent anyone on the team can `@`-mention.
 * Mentioning one opens a sandboxed session it answers in.
 *
 * A free-to-construct handle; the record loads lazily on first field access.
 */
export class Persona extends MacroEntity<PersonaRecord> {
  protected async fetch(): Promise<PersonaRecord> {
    return unwrap(
      await this.client.storage.getPersona({ path: { bot_id: this.id } }),
    );
  }

  /** A handle to a persona by bot id. Details load on first access. */
  static byId(client: MacroClient, id: string): Persona {
    return new Persona(client, id);
  }

  /**
   * Create a persona in a team the caller administers. `agent` defaults to the
   * standard harness and model with no instructions and no repository.
   */
  static async create(
    client: MacroClient,
    opts: {
      team: Team;
      name: string;
      handle: string;
      description?: string;
      avatarUrl?: string;
      agent?: PersonaAgent;
    },
  ): Promise<Persona> {
    const record = unwrap(
      await client.storage.createPersona({
        body: {
          team_id: opts.team.id,
          name: opts.name,
          handle: opts.handle,
          description: opts.description ?? null,
          avatar_url: opts.avatarUrl ?? null,
          agent: agentBody(
            opts.agent ?? { harness: 'open_code', model: 'claude' },
          ),
        },
      }),
    );
    return new Persona(client, record.id, record);
  }

  /** Every persona the caller's teams own. */
  static async list(client: MacroClient): Promise<Persona[]> {
    const records = unwrap(await client.storage.listPersonas());
    return records.map((record) => new Persona(client, record.id, record));
  }

  /**
   * Look a persona up by its `@` handle, or throw if none of the caller's
   * teams has one. Handles are unique per team, not globally.
   */
  static async byHandle(client: MacroClient, handle: string): Promise<Persona> {
    const wanted = handle.replace(/^@/, '');
    // `list` seeds every handle, so these resolve without a second round trip.
    for (const candidate of await Persona.list(client)) {
      if ((await candidate.handle()) === wanted) return candidate;
    }
    throw new MacroNotFoundError(`no persona @${wanted}`);
  }

  /** Display name. */
  name = this.field('name');
  /** Handle typed after the `@`. */
  handle = this.field('handle');
  /** Short description shown alongside the name. */
  description = this.field('description');
  /** Avatar URL, when it has one. */
  avatarUrl = this.field('avatar_url');

  /** The persona's canonical principal id (`bot|<uuid>`), used in mentions. */
  get principalId(): string {
    return `bot|${this.id}`;
  }

  /** What this persona runs: harness, model, instructions and repository. */
  async agentConfig(): Promise<PersonaAgent> {
    return toAgent(await this.detail.get());
  }

  /**
   * Update the persona. Omitted fields are left as they are; a supplied
   * `agent` replaces the whole configuration.
   */
  async update(fields: PersonaFields): Promise<this> {
    await this.mutate((client) =>
      client.storage.patchPersona({
        path: { bot_id: this.id },
        body: {
          name: fields.name,
          handle: fields.handle,
          description: fields.description,
          avatar_url: fields.avatarUrl,
          agent: fields.agent ? agentBody(fields.agent) : undefined,
        },
      }),
    );
    return this;
  }

  /** Delete the persona. Its handle becomes free for reuse. */
  async delete(): Promise<void> {
    await this.mutate((client) =>
      client.storage.deletePersona({ path: { bot_id: this.id } }),
    );
  }
}

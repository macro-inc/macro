import type { Persona as PersonaRecord } from '../../../generated/storage/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';

/** Fields a persona can be updated with. */
export interface PersonaFields {
  /** Display name. */
  name?: string;
  /** Handle typed after the `@`. */
  handle?: string;
  /** Short description shown alongside the name. `null` clears it. */
  description?: string | null;
  /** Avatar URL. `null` clears it. */
  avatarUrl?: string | null;
  /**
   * Markdown instructions prepended to every session this persona runs.
   * `null` clears them.
   */
  instructions?: string | null;
}

/**
 * A persona (shown to users as an "agent"): a named agent identity its owner
 * can `@`-mention. Mentioning one opens a session it answers in, primed with
 * the persona's instructions.
 *
 * A free-to-construct handle; the record loads lazily on first field access.
 */
export class Persona extends MacroEntity<PersonaRecord> {
  protected async fetch(): Promise<PersonaRecord> {
    return unwrap(
      await this.client.storage.getPersona({ path: { persona_id: this.id } }),
    );
  }

  /** A handle to a persona by id. Details load on first access. */
  static byId(client: MacroClient, id: string): Persona {
    return new Persona(client, id);
  }

  /** Create a persona owned by the caller. */
  static async create(
    client: MacroClient,
    opts: {
      name: string;
      handle: string;
      description?: string;
      avatarUrl?: string;
      instructions?: string;
    },
  ): Promise<Persona> {
    const record = unwrap(
      await client.storage.createPersona({
        body: {
          name: opts.name,
          handle: opts.handle,
          description: opts.description ?? null,
          avatar_url: opts.avatarUrl ?? null,
          system_prompt: opts.instructions ?? null,
        },
      }),
    );
    return new Persona(client, record.id, record);
  }

  /** Every persona the caller owns. */
  static async list(client: MacroClient): Promise<Persona[]> {
    const records = unwrap(await client.storage.listPersonas());
    return records.map((record) => new Persona(client, record.id, record));
  }

  /**
   * Look a persona up by its `@` handle, or throw if the caller owns none by
   * that name. Handles are unique per owner, not globally.
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
  /** Markdown instructions prepended to every session, when it has any. */
  instructions = this.field('system_prompt');

  /** The persona's canonical principal id (`bot|<uuid>`), used in mentions. */
  get principalId(): string {
    return `bot|${this.id}`;
  }

  /**
   * Update the persona. Omitted fields are left as they are; explicit `null`
   * clears a nullable field.
   */
  async update(fields: PersonaFields): Promise<this> {
    await this.mutate((client) =>
      client.storage.patchPersona({
        path: { persona_id: this.id },
        body: {
          name: fields.name,
          handle: fields.handle,
          description: fields.description,
          avatar_url: fields.avatarUrl,
          system_prompt: fields.instructions,
        },
      }),
    );
    return this;
  }

  /** Delete the persona. Its handle becomes free for reuse. */
  async delete(): Promise<void> {
    await this.mutate((client) =>
      client.storage.deletePersona({ path: { persona_id: this.id } }),
    );
  }
}

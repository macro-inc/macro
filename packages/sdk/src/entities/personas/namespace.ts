import type { MacroClient } from '../../utils/client';
import { Persona } from './persona';

export class PersonaNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to a persona by id. Details load on first access. */
  byId(id: string): Persona {
    return Persona.byId(this.client, id);
  }

  /** Look a persona up by its `@` handle. */
  byHandle(handle: string): Promise<Persona> {
    return Persona.byHandle(this.client, handle);
  }

  /** Every persona the caller owns. */
  list(): Promise<Persona[]> {
    return Persona.list(this.client);
  }

  /** Create a persona owned by the caller. */
  create(opts: {
    name: string;
    handle: string;
    description?: string;
    avatarUrl?: string;
    instructions?: string;
  }): Promise<Persona> {
    return Persona.create(this.client, opts);
  }
}

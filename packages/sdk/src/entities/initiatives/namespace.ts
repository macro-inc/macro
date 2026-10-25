import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Initiative, type InitiativeOptions } from './initiative';

/** Initiatives in the caller's workspace. */
export class InitiativeNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Construct a lazy initiative handle. */
  byId(id: string): Initiative {
    return Initiative.byId(this.client, id);
  }

  /** List accessible initiatives. */
  async list(): Promise<Initiative[]> {
    return unwrap(await this.client.storage.listInitiatives()).initiatives.map(
      (i) => Initiative.byId(this.client, i.id),
    );
  }

  /** Create an initiative. */
  async create(options: InitiativeOptions): Promise<Initiative> {
    return Initiative.from(
      this.client,
      unwrap(
        await this.client.storage.createInitiative({
          body: {
            name: options.name,
            description: options.description,
            memberIds: options.members?.map((u) => u.id),
            shareWithTeam: options.shareWithTeam,
            propertyValues: options.propertyValues,
          },
        }),
      ),
    );
  }
}

import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Initiative, type InitiativeOptions } from './initiative';

/** An initiative with the name and update time its listing already carries. */
export interface InitiativeSummary {
  initiative: Initiative;
  name: string;
  updatedAt: string;
}

/**
 * Initiatives in the caller's workspace; find one by name with one
 * `summaries()` call, not `name()` on each listed handle (one request each).
 */
export class InitiativeNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Construct a lazy initiative handle. */
  byId(id: string): Initiative {
    return Initiative.byId(this.client, id);
  }

  /** List accessible initiatives as handles; use `summaries()` for their names. */
  async list(): Promise<Initiative[]> {
    return unwrap(await this.client.storage.listInitiatives()).initiatives.map(
      (i) => Initiative.byId(this.client, i.id),
    );
  }

  /** Every accessible initiative with its name, in one request. */
  async summaries(): Promise<InitiativeSummary[]> {
    return unwrap(await this.client.storage.listInitiatives()).initiatives.map(
      (i) => ({
        initiative: Initiative.byId(this.client, i.id),
        name: i.name,
        updatedAt: i.updatedAt,
      }),
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

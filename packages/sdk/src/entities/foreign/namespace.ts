import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { ForeignEntity } from './foreign-entity';

export class ForeignEntityNamespace {
  constructor(private readonly client: MacroClient) {}

  byId(id: string): ForeignEntity {
    return ForeignEntity.byId(this.client, id);
  }

  /**
   * Look a foreign entity up by the identifier its source system assigned.
   *
   * `foreignEntityId` may contain slashes — sources store them inside the
   * identifier, for example `owner/repo/pull/12`.
   */
  async bySource(
    source: string,
    foreignEntityId: string,
  ): Promise<ForeignEntity> {
    return ForeignEntity.fromRecord(
      this.client,
      unwrap(
        await this.client.storage.getForeignEntityBySource({
          path: { source, foreign_entity_id: foreignEntityId },
        }),
      ),
    );
  }
}

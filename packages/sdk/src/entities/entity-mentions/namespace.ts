import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { EntityReference } from '../reference';
import { EntityMention } from './mention';

/** Stored entity mention relationships. */
export class EntityMentionNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Construct a stored mention handle. */
  byId(id: string): EntityMention {
    return EntityMention.byId(this.client, id);
  }

  /** Create a mention from a source resource to a target resource. */
  async create(
    source: EntityReference,
    target: EntityReference,
  ): Promise<EntityMention> {
    const result = unwrap(
      await this.client.storage.createEntityMention({
        body: {
          source_entity_id: source.entity.id,
          source_entity_type: source.type,
          entity_id: target.entity.id,
          entity_type: target.type,
        },
      }),
    );
    return EntityMention.byId(this.client, result.id);
  }
}

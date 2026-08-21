import type { GetForeignEntityResponses } from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { FavoritableEntity } from '../entity';

type ForeignEntityDetail = GetForeignEntityResponses[200];

/**
 * A read-only mapping to an entity owned by an external system (e.g. a
 * GitHub pull request). Keyed by the internal foreign-entity record id.
 */
export class ForeignEntity extends FavoritableEntity<ForeignEntityDetail> {
  /** Favorites identify foreign entities as `foreign_entity`. */
  readonly entityType = 'foreign_entity';

  protected async fetch(): Promise<ForeignEntityDetail> {
    return unwrap(
      await this.client.storage.getForeignEntity({ path: { id: this.id } }),
    );
  }

  /** A handle to a foreign entity by its internal record id. Details load on first access. */
  static byId(client: MacroClient, id: string): ForeignEntity {
    return new ForeignEntity(client, id);
  }

  /** The identifier assigned by the external system. */
  readonly foreignEntityId = this.field('foreignEntityId');

  /** The source system that owns the external identifier (e.g. `github_pull_request`). */
  readonly source = this.field('foreignEntitySource');

  /** The internal entity id this foreign entity is stored for. */
  readonly storedForId = this.field('storedForId');

  /** The internal auth entity namespace this foreign entity is stored for. */
  readonly storedForAuthEntity = this.field('storedForAuthEntity');

  /** When the record was created (ISO timestamp). */
  readonly createdAt = this.field('createdAt');

  /** When the record was last updated (ISO timestamp). */
  readonly updatedAt = this.field('updatedAt');

  /** Arbitrary source-specific metadata stored with the mapping. */
  async metadata(): Promise<unknown> {
    return (await this.detail.get()).metadata;
  }
}

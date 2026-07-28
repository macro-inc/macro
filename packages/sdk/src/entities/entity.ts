import type {
  BulkUpdateEntityPropertyOptionsResponse,
  EntityPropertyWithDefinition,
  PropertyTargetEntityType as PropertyEntityType,
  PropertyTargetReference,
  SetPropertyValue,
} from '../../generated/properties/types.gen';
import type { FavoriteEntityRef } from '../../generated/storage/types.gen';
import { Lazy, unwrap } from '../utils';
import type { MacroClient } from '../utils/client';
import type { PropertyDefinition } from './properties/property-definition';
import type { PropertyOption } from './properties/property-option';

/** How the entity-addressed APIs (favorites) identify an entity's type. */
export type MacroEntityType = FavoriteEntityRef['entityType'];

/** An entity that can be added to and removed from the user's favorites. */
export interface Favoritable {
  favorite(): Promise<this>;
  unfavorite(): Promise<this>;
}

/** A favoritable entity that also carries user-defined properties. */
export interface Propertied extends Favoritable {
  properties(opts?: {
    includeMetadata?: boolean;
  }): Promise<EntityPropertyWithDefinition[]>;
  setProperty(propertyId: string, value?: SetPropertyValue): Promise<void>;
  deleteProperty(entityPropertyId: string): Promise<void>;
}

/** A delta to apply to one multi-select property. */
export interface PropertyOptionDelta {
  /** The multi-select property definition to update. */
  property: PropertyDefinition;
  /** Options to add to the property's current selection. */
  add?: PropertyOption[];
  /** Options to remove from the property's current selection. */
  remove?: PropertyOption[];
}

/** `null` folded into `undefined`, so optional API fields read naturally. */
type Normalized<V> = null extends V
  ? NonNullable<V> | undefined
  : undefined extends V
    ? NonNullable<V> | undefined
    : V;

/**
 * Base for entity handles: a free-to-construct `(client, id)` pair whose
 * detail record loads lazily on first field access and is dropped after any
 * mutation. Subclasses implement {@link fetch} and build their surface from
 * {@link field} and {@link mutate}.
 */
export abstract class MacroEntity<Detail> {
  protected readonly detail: Lazy<Detail>;

  protected constructor(
    protected readonly client: MacroClient,
    public readonly id: string,
    seed?: Detail,
  ) {
    this.detail = new Lazy(() => this.fetch(), seed);
  }

  /** Load the detail record backing {@link field} accessors. */
  protected abstract fetch(): Promise<Detail>;

  /** A lazy accessor for one detail field, `null` normalized to `undefined`. */
  protected field<K extends keyof Detail>(
    key: K,
  ): () => Promise<Normalized<Detail[K]>> {
    return async () =>
      ((await this.detail.get())[key] ?? undefined) as Normalized<Detail[K]>;
  }

  /**
   * Like {@link field}, but maps the raw value through `map` before returning.
   * Used to expose an id field as a handle to the entity it references, e.g.
   * `this.mappedField('owner', (id) => User.byId(this.client, id))`.
   */
  protected mappedField<K extends keyof Detail, T>(
    key: K,
    map: (value: Normalized<Detail[K]>) => T,
  ): () => Promise<T> {
    return async () =>
      map(
        ((await this.detail.get())[key] ?? undefined) as Normalized<Detail[K]>,
      );
  }

  toJSON(): { id: string; detail?: Detail } {
    const detail = this.detail.peek();
    return detail === undefined ? { id: this.id } : { id: this.id, detail };
  }

  /** Run a write, unwrap it, and drop the cached detail so reads refetch. */
  protected async mutate<TData>(
    fn: (client: MacroClient) => Promise<{
      data?: TData;
      error?: unknown;
      response?: Response;
    }>,
  ): Promise<TData> {
    const out = unwrap(await fn(this.client));
    this.detail.clear();
    return out;
  }
}

/** An entity the favorites API can address, and so can be (un)favorited. */
export abstract class FavoritableEntity<Detail>
  extends MacroEntity<Detail>
  implements Favoritable
{
  /** How the entity-addressed APIs (favorites) identify this entity's type. */
  abstract readonly entityType: MacroEntityType;

  /**
   * Add this entity to the user's favorites. Returns this handle for chaining.
   * Plain unwrap: favoriting alters the user's favorites collection, not this
   * entity's own detail, so there's nothing cached to invalidate.
   */
  async favorite(): Promise<this> {
    unwrap(
      await this.client.storage.addFavorite({
        body: { entityId: this.id, entityType: this.entityType },
      }),
    );
    return this;
  }

  /** Remove this entity from the user's favorites. Returns this handle for chaining. */
  async unfavorite(): Promise<this> {
    unwrap(
      await this.client.storage.removeFavoriteByEntity({
        path: {
          entity_type: this.entityType,
          entity_id: this.id,
        },
      }),
    );
    return this;
  }
}

/** A favoritable entity that also carries user-defined properties. */
export abstract class PropertiedEntity<Detail>
  extends FavoritableEntity<Detail>
  implements Propertied
{
  /**
   * This entity's type in the properties service, which names types
   * differently from {@link entityType} (e.g. `THREAD` for `email_thread`).
   */
  protected abstract readonly propertyEntityType: PropertyEntityType;

  /** This entity's reference for bulk property operations. */
  propertyReference(): PropertyTargetReference {
    return { entity_type: this.propertyEntityType, entity_id: this.id };
  }

  /** The properties set on this entity, each with its definition, value, and options. */
  async properties(opts?: {
    includeMetadata?: boolean;
  }): Promise<EntityPropertyWithDefinition[]> {
    const { properties } = unwrap(
      await this.client.properties.getEntityProperties({
        path: {
          entity_type: this.propertyEntityType,
          entity_id: this.id,
        },
        query:
          opts?.includeMetadata !== undefined
            ? { include_metadata: opts.includeMetadata }
            : undefined,
      }),
    );
    return properties;
  }

  /**
   * Set a property value on this entity by property definition id, or attach
   * the property without a value when `value` is omitted.
   */
  async setProperty(
    propertyId: string,
    value?: SetPropertyValue,
  ): Promise<void> {
    unwrap(
      await this.client.properties.setEntityProperty({
        path: {
          entity_type: this.propertyEntityType,
          entity_id: this.id,
          property_id: propertyId,
        },
        body: { value: value ?? null },
      }),
    );
  }

  /** Apply multi-select option deltas atomically across this entity's properties. */
  async updatePropertyOptions(
    changes: PropertyOptionDelta[],
  ): Promise<BulkUpdateEntityPropertyOptionsResponse> {
    return unwrap(
      await this.client.properties.bulkUpdateEntityPropertyOptions({
        path: this.propertyReference(),
        body: {
          properties: changes.map((change) => ({
            property_id: change.property.id,
            ...(change.add
              ? { add_option_ids: change.add.map((option) => option.id) }
              : {}),
            ...(change.remove
              ? { remove_option_ids: change.remove.map((option) => option.id) }
              : {}),
          })),
        },
      }),
    );
  }

  /**
   * Remove a property from this entity by its entity-property assignment id
   * (the `property.id` of a {@link properties} entry).
   */
  async deleteProperty(entityPropertyId: string): Promise<void> {
    unwrap(
      await this.client.properties.deleteEntityProperty({
        path: { entity_property_id: entityPropertyId },
      }),
    );
  }
}

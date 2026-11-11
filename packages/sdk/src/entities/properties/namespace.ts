import type {
  BulkEntityOptionUpdateResult,
  BulkEntityPropertiesRequest,
  CreatePropertyScope,
  EntityPropertiesResponse,
  PropertyDataType,
  PropertyDefinition as PropertyDefinitionRecord,
  PropertyTargetEntityType as PropertyEntityType,
  PropertyScope,
  TagScope,
  TagSetResponse,
} from '../../../generated/properties/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { PropertiedEntity, PropertyOptionDelta } from '../entity';
import { PropertyDefinition } from './property-definition';
import { PropertyOption } from './property-option';

export type {
  BulkEntityPropertiesRequest,
  CreatePropertyScope,
  EntityPropertiesResponse,
  PropertyDataType,
  PropertyDefinitionRecord,
  PropertyEntityType,
  PropertyScope,
  TagScope,
  TagSetResponse,
};

export { PropertyDefinition, PropertyOption };

/**
 * Property definitions and tag sets. Entity-level reads and writes live on
 * the entity handles ({@link PropertiedEntity.properties}, `setProperty`,
 * `deleteProperty`).
 *
 * @routing Use when the request is about an item's custom properties or tags themselves, such as defining a property, creating or editing a tag, or bulk-setting options; not creating or updating a task, deal, event or row, whose own methods set their fields.
 */
export class PropertiesNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * List property definitions visible to the user, pre-hydrated with their records.
   *
   * @readonly
   */
  async list(opts?: {
    scope?: PropertyScope;
    forEntityType?: PropertyEntityType;
  }): Promise<PropertyDefinition[]> {
    const raw = unwrap(
      await this.client.properties.listProperties({
        query: {
          scope: opts?.scope ?? 'all',
          ...(opts?.forEntityType !== undefined
            ? { for_entity_type: opts.forEntityType }
            : {}),
        },
      }),
    );
    return raw.map((item) => {
      const record =
        'definition' in item
          ? item.definition
          : (item as PropertyDefinitionRecord);
      return PropertyDefinition.fromRecord(this.client, record);
    });
  }

  /**
   * Create a new custom property definition.
   *
   * @write
   */
  create(opts: {
    displayName: string;
    scope: CreatePropertyScope;
    dataType: PropertyDataType;
  }): Promise<PropertyDefinition> {
    return PropertyDefinition.create(this.client, opts);
  }

  /**
   * A handle to an existing property definition by id.
   *
   * @readonly
   */
  definition(id: string): PropertyDefinition {
    return PropertyDefinition.byId(this.client, id);
  }

  /**
   * Get properties for multiple entities in a single request.
   *
   * @readonly
   */
  async bulkEntityProperties(
    request: BulkEntityPropertiesRequest,
  ): Promise<Record<string, EntityPropertiesResponse>> {
    return unwrap(
      await this.client.properties.getBulkEntityProperties({ body: request }),
    );
  }

  /**
   * Apply one multi-select option delta to several entity handles.
   *
   * @write
   * @idempotent
   * @mcp-exclude Takes a handle built from a listing record, which an MCP call can't reference.
   */
  async updateEntityPropertyOptions(
    entities: PropertiedEntity<unknown>[],
    change: PropertyOptionDelta,
  ): Promise<BulkEntityOptionUpdateResult[]> {
    const response = unwrap(
      await this.client.properties.bulkUpdateEntitiesPropertyOptions({
        body: {
          entities: entities.map((entity) => entity.propertyReference()),
          property_id: change.property.id,
          ...(change.add
            ? { add_option_ids: change.add.map((option) => option.id) }
            : {}),
          ...(change.remove
            ? { remove_option_ids: change.remove.map((option) => option.id) }
            : {}),
        },
      }),
    );
    return response.results;
  }

  /**
   * Add a select option to a multi-select property value on an entity.
   *
   * @write
   * @idempotent
   * @mcp-exclude Takes a handle built from a listing record, which an MCP call can't reference.
   */
  async addEntityPropertyOption(opts: {
    entity: PropertiedEntity<unknown>;
    property: PropertyDefinition;
    option: PropertyOption;
  }): Promise<void> {
    return unwrap(
      await this.client.properties.addEntityPropertyOption({
        path: {
          ...opts.entity.propertyReference(),
          property_id: opts.property.id,
          option_id: opts.option.id,
        },
      }),
    );
  }

  /**
   * Remove a select option from a multi-select property value on an entity.
   *
   * @write
   * @idempotent
   * @mcp-exclude Takes a handle built from a listing record, which an MCP call can't reference.
   */
  async removeEntityPropertyOption(opts: {
    entity: PropertiedEntity<unknown>;
    property: PropertyDefinition;
    option: PropertyOption;
  }): Promise<void> {
    return unwrap(
      await this.client.properties.removeEntityPropertyOption({
        path: {
          ...opts.entity.propertyReference(),
          property_id: opts.property.id,
          option_id: opts.option.id,
        },
      }),
    );
  }

  /**
   * The user's tag sets: their personal set, plus their team's when on a team.
   * A set without a `definition` has no tags yet; {@link createTag} creates it.
   * Edit or delete a tag through `definition(set.definition.id).options()`.
   *
   * @readonly
   */
  async tags(): Promise<TagSetResponse[]> {
    return unwrap(await this.client.properties.listTags({}));
  }

  /**
   * Create a tag, provisioning the tag set on its first tag. Tags match by
   * label, so check {@link tags} first and never duplicate one in the same set.
   * Apply it with `item.updatePropertyOptions([{ property, add: [tag] }])`,
   * where `property` is `definition(tag.definitionId)`.
   *
   * @write
   */
  async createTag(opts: {
    /** The label, e.g. "Urgent". */
    label: string;
    /** A hex color such as `#46A758`. */
    color?: string;
    /** `user` (the default) for the user's own tags, `team` for their team's shared tags. */
    scope?: TagScope;
  }): Promise<PropertyOption> {
    const set = unwrap(
      await this.client.properties.ensureTagSet({
        body: { scope: opts.scope ?? 'user' },
      }),
    );
    if (!set.definition) {
      throw new Error('The tag set was not provisioned');
    }

    return PropertyDefinition.byId(this.client, set.definition.id).addOption({
      type: 'select_string',
      option: {
        value: opts.label,
        color: opts.color,
        display_order: set.options.length,
      },
    });
  }
}

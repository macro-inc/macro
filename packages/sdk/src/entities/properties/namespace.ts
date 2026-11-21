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
 * @routing Use when defining custom properties or tags: adding a custom field to tasks or documents (hours spent, a priority), creating or editing a tag, or bulk-setting options; not setting a field an item already has, which its own methods do, or CRM pipeline fields.
 *
 * @agent
 * A custom property is a field you define once and then set on items: tasks, documents, projects, channels, chats, email threads and CRM companies, each through its own `setProperty(property, value)`. Reuse an existing property with the same name before creating one, after checking its `dataType` is the kind you need; names are unique, so ask before changing a same-named property of another kind. Create it in the user's own scope (the default); pass `scope: 'team'` only when the user asks to share the field with the whole team, and say which scope you used. A property's `dataType` getter answers the stored kind (`'NUMBER'`), but `create` takes `dataType: {type: 'number'}`, and a value is `{type: 'number', value}` (see `properties.SetPropertyValue`). CRM pipeline fields belong to the pipeline, not here.
 *
 * ```typescript
 * export async function main({macro}: CodeContext) {
 *   // Reuse the user's own Hours Spent number field, or create it, then set it on one task.
 *   const own = await macro.properties.list({scope: 'user'});
 *   const names = await Promise.all(own.map((property) => property.displayName));
 *   const kinds = await Promise.all(own.map((property) => property.dataType));
 *   const index = names.indexOf('Hours Spent');
 *   // Names are unique, so a same-named field of another kind can't be reused or recreated.
 *   if (index !== -1 && kinds[index] !== 'NUMBER') {
 *     return {data: {error: `Your Hours Spent field holds ${kinds[index]}, not a number; ask before changing it.`}};
 *   }
 *   const hours =
 *     own[index] ??
 *     (await macro.properties.create({displayName: 'Hours Spent', dataType: {type: 'number'}}));
 *   const updated: string[] = [];
 *   for await (const task of macro.tasks.search('launch checklist', {maxItems: 1})) {
 *     await task.setProperty(hours, {type: 'number', value: 3.5});
 *     updated.push(task.webUrl());
 *   }
 *   return {data: {property: hours.id, scope: 'user', updated}};
 * }
 * ```
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
    /** `user` (the default) for the user's own property; `team` shares it with the whole team, only when the user asks. */
    scope?: CreatePropertyScope;
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
    /** A hex color such as `#46A758`; defaults to the next color of the tag palette. */
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

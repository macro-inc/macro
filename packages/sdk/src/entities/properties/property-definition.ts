import type {
  AddPropertyOptionRequest,
  DataType,
  PropertyDefinition as PropertyDefinitionRecord,
  PropertyOwner,
} from '../../../generated/properties/types.gen';
import { Lazy, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { CreatePropertyScope, PropertyDataType } from './namespace';
import {
  PropertyOption,
  type UpdatePropertyOptionRequest,
} from './property-option';

export type { AddPropertyOptionRequest, UpdatePropertyOptionRequest };
export { PropertyOption };

/**
 * A property definition: schema for a custom field that can be attached to
 * entities. Obtain instances via {@link PropertiesNamespace.create},
 * {@link PropertiesNamespace.list}, or {@link PropertiesNamespace.definition}.
 */
export class PropertyDefinition {
  private readonly detail: Lazy<PropertyDefinitionRecord>;

  private constructor(
    private readonly client: MacroClient,
    readonly id: string,
    seed?: PropertyDefinitionRecord,
  ) {
    this.detail = new Lazy(() => this.fetch(), seed);
  }

  private async fetch(): Promise<PropertyDefinitionRecord> {
    return unwrap(
      await this.client.properties.getPropertyDefinition({
        path: { definition_id: this.id },
      }),
    );
  }

  /** Create a new property definition. */
  static async create(
    client: MacroClient,
    opts: {
      displayName: string;
      scope: CreatePropertyScope;
      dataType: PropertyDataType;
    },
  ): Promise<PropertyDefinition> {
    const record = unwrap(
      await client.properties.createPropertyDefinition({
        body: {
          display_name: opts.displayName,
          scope: opts.scope,
          data_type: opts.dataType,
        },
      }),
    );
    return new PropertyDefinition(client, record.id, record);
  }

  /** A handle to an existing definition by id. Fields load lazily on first access. */
  static byId(client: MacroClient, id: string): PropertyDefinition {
    return new PropertyDefinition(client, id);
  }

  /** Wrap a record already in hand (e.g. from a list response). */
  static fromRecord(
    client: MacroClient,
    record: PropertyDefinitionRecord,
  ): PropertyDefinition {
    return new PropertyDefinition(client, record.id, record);
  }

  get displayName(): Promise<string> {
    return this.detail.get().then((r) => r.display_name);
  }

  get dataType(): Promise<DataType> {
    return this.detail.get().then((r) => r.data_type);
  }

  get owner(): Promise<PropertyOwner> {
    return this.detail.get().then((r) => r.owner);
  }

  get isSystem(): Promise<boolean> {
    return this.detail.get().then((r) => r.is_system);
  }

  get isMultiSelect(): Promise<boolean> {
    return this.detail.get().then((r) => r.is_multi_select);
  }

  get createdAt(): Promise<string> {
    return this.detail.get().then((r) => r.created_at);
  }

  get updatedAt(): Promise<string> {
    return this.detail.get().then((r) => r.updated_at);
  }

  /** Delete this property definition. */
  async delete(): Promise<void> {
    return unwrap(
      await this.client.properties.deletePropertyDefinition({
        path: { definition_id: this.id },
      }),
    );
  }

  /** The selectable options for this definition (select-type properties). */
  async options(): Promise<PropertyOption[]> {
    const records = unwrap(
      await this.client.properties.getPropertyOptions({
        path: { definition_id: this.id },
      }),
    );
    return records.map((r) => PropertyOption.from(this.client, this.id, r));
  }

  /** Add an option to this select-type property. */
  async addOption(option: AddPropertyOptionRequest): Promise<PropertyOption> {
    const record = unwrap(
      await this.client.properties.addPropertyOption({
        path: { definition_id: this.id },
        body: option,
      }),
    );
    return PropertyOption.from(this.client, this.id, record);
  }

  /** Update an option (label, color, display order). */
  async updateOption(
    option: PropertyOption,
    updates: UpdatePropertyOptionRequest,
  ): Promise<PropertyOption> {
    const record = unwrap(
      await this.client.properties.updatePropertyOption({
        path: { definition_id: this.id, option_id: option.id },
        body: updates,
      }),
    );
    return PropertyOption.from(this.client, this.id, record);
  }

  /** Delete an option from this property. */
  async deleteOption(option: PropertyOption): Promise<void> {
    return unwrap(
      await this.client.properties.deletePropertyOption({
        path: { definition_id: this.id, option_id: option.id },
      }),
    );
  }
}

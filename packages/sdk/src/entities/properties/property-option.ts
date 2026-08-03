import type {
  PropertyOption as PropertyOptionRecord,
  UpdatePropertyOptionRequest,
} from '../../../generated/properties/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

export type { UpdatePropertyOptionRequest };

/**
 * A selectable option on a select-type property definition. There is no
 * single-option GET, so instances are only built from a seed record — via
 * {@link PropertyDefinition.options} or {@link PropertyDefinition.addOption}.
 */
export class PropertyOption {
  private constructor(
    private readonly client: MacroClient,
    /** The property definition this option belongs to. */
    readonly definitionId: string,
    readonly id: string,
    private record: PropertyOptionRecord,
  ) {}

  /** Wrap a record already in hand (e.g. from a list or create response). */
  static from(
    client: MacroClient,
    definitionId: string,
    record: PropertyOptionRecord,
  ): PropertyOption {
    return new PropertyOption(client, definitionId, record.id, record);
  }

  /** The option's value (string or number, per the property's data type). */
  get value(): PropertyOptionRecord['value'] {
    return this.record.value;
  }

  /** The option's display color, if set. */
  get color(): string | undefined {
    return this.record.color ?? undefined;
  }

  /** The option's position among its definition's options. */
  get displayOrder(): number {
    return this.record.display_order;
  }

  /** When the option was created. */
  get createdAt(): string {
    return this.record.created_at;
  }

  /** When the option was last updated. */
  get updatedAt(): string {
    return this.record.updated_at;
  }

  /** Update this option's label, color, or display order. */
  async update(updates: UpdatePropertyOptionRequest): Promise<this> {
    this.record = unwrap(
      await this.client.properties.updatePropertyOption({
        path: { definition_id: this.definitionId, option_id: this.id },
        body: updates,
      }),
    );
    return this;
  }

  /** Delete this option from its property definition. */
  async delete(): Promise<void> {
    unwrap(
      await this.client.properties.deletePropertyOption({
        path: { definition_id: this.definitionId, option_id: this.id },
      }),
    );
  }
}

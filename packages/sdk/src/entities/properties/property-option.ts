import type {
  PropertyOption as PropertyOptionRecord,
  TagPromotionConflictResponse,
  UpdatePropertyOptionRequest,
} from '../../../generated/properties/types.gen';
import {
  MacroApiError,
  MacroError,
  MacroNotFoundError,
  unwrap,
} from '../../utils';
import type { MacroClient } from '../../utils/client';

export type { UpdatePropertyOptionRequest };

/**
 * A label could not be shared with the team because the team already has one
 * with that name. Merge into {@link conflictingOption} to go ahead with the
 * team's version, or rename this label first.
 */
export class TagNameConflictError extends MacroError {
  constructor(
    /** The team label that already uses this name. */
    readonly conflictingOption: PropertyOption,
  ) {
    super('The team already has a label with that name');
    this.name = 'TagNameConflictError';
  }
}

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

  /**
   * Share this personal label with the user's team.
   *
   * The label moves into the team tag set keeping its id, so everything already
   * tagged with it stays tagged — it just becomes visible to, and usable by,
   * the whole team. Returns a handle on the label in its new home; this one is
   * stale afterwards.
   *
   * @throws {TagNameConflictError} when the team already has a label with this
   * name. Pass `error.conflictingOption` to {@link merge} to go ahead with the
   * team's version.
   */
  async promote(): Promise<PropertyOption> {
    const result = await this.client.properties.promoteTag({
      body: { option_id: this.id },
    });

    if (result.error !== undefined) {
      const conflict = tagNameConflict(result.response?.status, result.error);
      if (conflict !== undefined) {
        throw new TagNameConflictError(
          await loadOption(
            this.client,
            conflict.conflicting_option.propertyDefinitionId,
            conflict.conflicting_option.id,
          ),
        );
      }
      throw new MacroApiError(result.response?.status ?? 0, result.error);
    }

    const promoted = unwrap(result);
    return loadOption(this.client, promoted.propertyDefinitionId, this.id);
  }

  /**
   * Replace this personal label with an existing team label.
   *
   * Everything tagged with this label is retagged with `target` (deduped if it
   * already has both), then this label is deleted. The team label's name and
   * color win, so the returned handle is `target`, freshly read.
   */
  async merge(target: PropertyOption): Promise<PropertyOption> {
    const merged = unwrap(
      await this.client.properties.mergeTag({
        body: { option_id: this.id, target_option_id: target.id },
      }),
    );
    return loadOption(this.client, merged.propertyDefinitionId, merged.id);
  }
}

/**
 * Read one option back from the definition that owns it. The tag endpoints
 * answer with the response shape, which carries no timestamps, so a handle is
 * built from a fresh read rather than from a partial record.
 */
async function loadOption(
  client: MacroClient,
  definitionId: string,
  optionId: string,
): Promise<PropertyOption> {
  const records = unwrap(
    await client.properties.getPropertyOptions({
      path: { definition_id: definitionId },
    }),
  );
  const record = records.find((candidate) => candidate.id === optionId);
  if (record === undefined) {
    throw new MacroNotFoundError(
      `label ${optionId} is not in property definition ${definitionId}`,
    );
  }
  return PropertyOption.from(client, definitionId, record);
}

/** Read a tag-name collision out of a failed promote, if that is what it was. */
function tagNameConflict(
  status: number | undefined,
  error: unknown,
): TagPromotionConflictResponse | undefined {
  if (status !== 409) return undefined;
  const body = error as Partial<TagPromotionConflictResponse> | undefined;
  return body?.conflicting_option !== undefined
    ? (body as TagPromotionConflictResponse)
    : undefined;
}

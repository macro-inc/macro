import { timeRangeFromInstants } from '@app/features/database/core/cell-date-range';
import { propertyValueToApi } from '@property/api/converters';
import type {
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '@property/types';
import { toPropertyApiValue } from '@property/utils/typeGuards';
import type { SetPropertyValue } from '@service-storage/generated/schemas/setPropertyValue';
import type { TaskTemplateConfiguration } from '@service-storage/generated/schemas/taskTemplateConfiguration';
import type { TaskTemplateContents } from '../core/template';

function decodeDefault(
  value: SetPropertyValue,
  definition: PropertyDefinitionDomain
): PropertyApiValues | null {
  const valueType = definition.valueType;
  if (valueType === 'TAG') return null;
  const property = { valueType };
  switch (value.type) {
    case 'boolean':
    case 'number':
    case 'string':
      return toPropertyApiValue(property, value.value);
    case 'date':
      return toPropertyApiValue(property, new Date(value.value));
    case 'date_range':
      return toPropertyApiValue(
        property,
        timeRangeFromInstants(value.value) ?? null
      );
    case 'select_option':
      return toPropertyApiValue(property, [value.option_id]);
    case 'multi_select_option':
      return toPropertyApiValue(property, value.option_ids);
    case 'entity_reference':
      return toPropertyApiValue(property, [value.reference]);
    case 'multi_entity_reference':
      return toPropertyApiValue(property, value.references);
    case 'link':
      return toPropertyApiValue(property, [value.url]);
    case 'multi_link':
      return toPropertyApiValue(property, value.urls);
  }
}

/** Decode defaults against current definitions, skipping unavailable or incompatible fields. */
export function taskTemplateContents(
  configuration: TaskTemplateConfiguration,
  definitions: readonly PropertyDefinitionDomain[]
): TaskTemplateContents {
  const available = new Map(
    definitions.map((definition) => [definition.id, definition])
  );
  const propertyDefaults: Record<string, PropertyApiValues> = {};
  for (const item of configuration.defaults ?? []) {
    const definition = available.get(item.propertyId);
    if (!definition) continue;
    const value = decodeDefault(item.value, definition);
    if (value) propertyDefaults[item.propertyId] = value;
  }
  return {
    propertyIds: [...configuration.propertyIds],
    propertyDefaults,
    descriptionMarkdown: configuration.descriptionMarkdown,
  };
}

/** Encode editor values through the same converter used by task creation. */
export function taskTemplateConfiguration(
  contents: TaskTemplateContents,
  definitions: readonly PropertyDefinitionDomain[],
  previous?: TaskTemplateConfiguration
): TaskTemplateConfiguration {
  const available = new Map(
    definitions.map((definition) => [definition.id, definition])
  );
  const retainedIds = (previous?.propertyIds ?? []).filter(
    (id) => !available.has(id)
  );
  const retained = new Set(retainedIds);
  return {
    propertyIds: [...new Set([...contents.propertyIds, ...retainedIds])],
    defaults: [
      ...contents.propertyIds.flatMap((id) => {
        const value = contents.propertyDefaults[id];
        const definition = available.get(id);
        if (!value || !definition) return [];
        const converted = propertyValueToApi(value, definition.isMultiSelect);
        return converted ? [{ propertyId: id, value: converted }] : [];
      }),
      ...(previous?.defaults ?? []).filter((item) =>
        retained.has(item.propertyId)
      ),
    ],
    descriptionMarkdown: contents.descriptionMarkdown,
  };
}

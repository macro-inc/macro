import { timeRangeFromInstants } from '@app/features/database/core/cell-date-range';
import type { SavedTaskTemplate } from '@app/features/task-composer/core/template-selection';
import { propertyValueToApi } from '@property/api/converters';
import type {
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '@property/types';
import { toPropertyApiValue } from '@property/utils/typeGuards';
import type { SetPropertyValue } from '@service-storage/generated/schemas/setPropertyValue';
import type { TaskTemplate } from '@service-storage/generated/schemas/taskTemplate';
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
    title: configuration.title ?? undefined,
    shareWithTeam: configuration.shareWithTeam ?? undefined,
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
    title: contents.title,
    shareWithTeam: contents.shareWithTeam,
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

/** The read before an update can confirm a response lost after the write. */
export function isConfirmedTemplateUpdate(
  observed: TaskTemplate,
  original: SavedTaskTemplate,
  viewerId: string,
  name: string,
  requested: TaskTemplateConfiguration
): boolean {
  if (
    observed.id !== original.id ||
    observed.revision !== original.revision + 1 ||
    !observed.canManage ||
    observed.name !== name ||
    (observed.teamId ?? null) !== original.teamId ||
    (original.teamId === null && observed.userId !== viewerId) ||
    (original.teamId !== null && observed.userId != null)
  )
    return false;

  const normalize = (configuration: TaskTemplateConfiguration) =>
    JSON.stringify({
      title: configuration.title ?? '',
      shareWithTeam: configuration.shareWithTeam ?? undefined,
      propertyIds: configuration.propertyIds,
      descriptionMarkdown: configuration.descriptionMarkdown,
      defaults: (configuration.defaults ?? [])
        .map((item) => {
          const value = item.value;
          if (value.type === 'date') {
            return {
              propertyId: item.propertyId,
              value: {
                type: value.type,
                value: new Date(value.value).toISOString(),
              },
            };
          }
          if (value.type === 'date_range') {
            return {
              propertyId: item.propertyId,
              value: {
                type: value.type,
                value: {
                  start: new Date(value.value.start).toISOString(),
                  end: new Date(value.value.end).toISOString(),
                },
              },
            };
          }
          return item;
        })
        .sort((a, b) => a.propertyId.localeCompare(b.propertyId)),
    });
  return normalize(observed.configuration) === normalize(requested);
}

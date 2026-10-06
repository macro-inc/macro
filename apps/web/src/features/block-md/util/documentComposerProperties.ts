import { useLocalDocTags } from '@property/tags';
import type { PropertyApiValues } from '@property/types';
import { useTagsQuery } from '@queries/properties/tags';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import type { PropertyDefinitionDetailResponse } from '@service-properties/generated/schemas/propertyDefinitionDetailResponse';
import { createStore, reconcile, unwrap } from 'solid-js/store';

/** Local tag state for the slash-command document composer. No system pills. */
export function createDocumentComposerTags(
  initialValues: Record<string, PropertyApiValues> = {}
) {
  const [propertyValues, setPropertyValues] =
    createStore<Record<string, PropertyApiValues>>(initialValues);

  const tagsQuery = useTagsQuery();

  const composerTags = useLocalDocTags(
    (definitionId) => {
      const value = propertyValues[definitionId];
      return value?.valueType === 'SELECT_STRING' && value.values
        ? value.values
        : [];
    },
    (definition, optionIds) => {
      setPropertyValues(definition.id, {
        valueType: 'SELECT_STRING',
        values: optionIds,
      });
    }
  );

  const clearComposerTags = () => {
    setPropertyValues(reconcile({}));
  };

  const createDefinitions = () => {
    const map = new Map<
      PropertyDefinition['id'],
      PropertyDefinition | PropertyDefinitionDetailResponse
    >();
    for (const tagSet of tagsQuery.isSuccess ? tagsQuery.data : []) {
      if (tagSet.definition) {
        map.set(tagSet.definition.id, tagSet.definition);
      }
    }
    return map;
  };

  return {
    propertyValues,
    setPropertyValues,
    composerTags,
    clearComposerTags,
    tagEntries: () => structuredClone(Object.entries(unwrap(propertyValues))),
    createDefinitions,
  };
}

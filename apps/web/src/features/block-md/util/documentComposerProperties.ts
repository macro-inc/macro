import { useLocalDocTags } from '@property/tags/useDocTags';
import type { PropertyApiValues } from '@property/types';
import { useTagsQuery } from '@queries/properties/tags';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import type { PropertyDefinitionDetailResponse } from '@service-properties/generated/schemas/propertyDefinitionDetailResponse';
import type { Accessor } from 'solid-js';
import { createStore, reconcile, unwrap } from 'solid-js/store';

/** Local tag state for the slash-command document composer. No system pills. */
export function createDocumentComposerTags(
  initialValues: Record<string, PropertyApiValues> = {},
  control?: {
    values: Accessor<Record<string, PropertyApiValues>>;
    onChange(values: Record<string, PropertyApiValues>): void;
  }
) {
  const [propertyValues, setPropertyValues] =
    createStore<Record<string, PropertyApiValues>>(initialValues);

  const tagsQuery = useTagsQuery();
  const values = () => control?.values() ?? propertyValues;
  const replaceValues = (next: Record<string, PropertyApiValues>) => {
    if (control) control.onChange(next);
    else setPropertyValues(reconcile(next));
  };

  const composerTags = useLocalDocTags(
    (definitionId) => {
      const value = values()[definitionId];
      return value?.valueType === 'SELECT_STRING' && value.values
        ? value.values
        : [];
    },
    (definition, optionIds) => {
      replaceValues({
        ...values(),
        [definition.id]: {
          valueType: 'SELECT_STRING',
          values: optionIds,
        },
      });
    }
  );

  const clearComposerTags = () => {
    replaceValues({});
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
    composerTags,
    clearComposerTags,
    tagEntries: () => structuredClone(Object.entries(unwrap(values()))),
    createDefinitions,
  };
}

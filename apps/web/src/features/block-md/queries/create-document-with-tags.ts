import { toast } from '@core/component/Toast/Toast';
import { createMarkdownFile } from '@core/util/create';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import type { PropertyApiValues } from '@property/types';
import { saveCreatedEntityTags } from '@queries/properties/graphql/created-entity-tags';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import type { PropertyDefinitionDetailResponse } from '@service-properties/generated/schemas/propertyDefinitionDetailResponse';

/**
 * Make a markdown document and apply any composer tags afterwards.
 * Create → Document still uses {@link createMarkdownFile} directly.
 */
export async function createDocumentWithTags(
  documentTitle: string,
  documentContent: string,
  properties: Array<[string, PropertyApiValues]>,
  definitions: Map<
    string,
    PropertyDefinition | PropertyDefinitionDetailResponse
  >,
  upsertToHistory: (params: { itemId: string; itemType: 'document' }) => void,
  options?: {
    onMutate?: () => void;
  }
) {
  const generation = cacheSessionGeneration.capture();
  options?.onMutate?.();

  const documentId = await createMarkdownFile({
    title: documentTitle,
    content: documentContent,
    source: 'document_composer',
  });

  if (!documentId) {
    toast.failure('Failed to create Document');
    return null;
  }

  if (!cacheSessionGeneration.isCurrent(generation)) return { documentId };

  upsertToHistory({
    itemId: documentId,
    itemType: 'document',
  });

  const tagUpdates = properties.flatMap(([id, value]) => {
    if (
      (value.valueType !== 'SELECT_STRING' &&
        value.valueType !== 'SELECT_NUMBER') ||
      !value.values?.length
    ) {
      return [];
    }
    const definition = definitions.get(id);
    const isMultiSelect = definition
      ? 'is_multi_select' in definition
        ? definition.is_multi_select
        : definition.isMultiSelect
      : true;
    return [
      {
        propertyDefinitionId: id,
        addOptionIds: isMultiSelect ? value.values : value.values.slice(0, 1),
        removeOptionIds: [],
      },
    ];
  });

  if (tagUpdates.length > 0) {
    try {
      await saveCreatedEntityTags({
        entityType: 'DOCUMENT',
        entityId: documentId,
        properties: tagUpdates,
      });
    } catch {
      toast.failure(
        'Document created, but tags could not be saved. Add them from the document.'
      );
    }
  }

  return { documentId };
}

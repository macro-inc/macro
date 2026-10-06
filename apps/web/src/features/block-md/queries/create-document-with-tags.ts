import { toast } from '@core/component/Toast/Toast';
import { createMarkdownFile } from '@core/util/create';
import { propertyValueToApi } from '@property/api/converters';
import type { PropertyApiValues } from '@property/types';
import { refetchSoupEntity } from '@queries/soup/cache';
import { propertiesServiceClient } from '@service-properties/client';
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

  upsertToHistory({
    itemId: documentId,
    itemType: 'document',
  });

  const tagUpdates = properties.flatMap(([id, value]) => {
    const definition = definitions.get(id);
    const isMultiSelect = definition
      ? 'is_multi_select' in definition
        ? definition.is_multi_select
        : definition.isMultiSelect
      : true;
    const apiValue = propertyValueToApi(value, isMultiSelect);
    if (apiValue === null) return [];
    if (
      apiValue.type !== 'multi_select_option' &&
      apiValue.type !== 'select_option'
    ) {
      return [];
    }
    const optionIds =
      apiValue.type === 'multi_select_option'
        ? apiValue.option_ids
        : [apiValue.option_id];
    if (optionIds.length === 0) return [];
    return [
      {
        property_id: id,
        add_option_ids: optionIds,
        remove_option_ids: [],
      },
    ];
  });

  if (tagUpdates.length > 0) {
    try {
      const result =
        await propertiesServiceClient.bulkUpdateEntityPropertyOptions({
          entity_type: 'DOCUMENT',
          entity_id: documentId,
          body: { properties: tagUpdates },
        });
      if (result.isErr()) throw result.error;
      refetchSoupEntity(documentId, 'document', { refreshGraphql: true });
    } catch {
      toast.failure(
        'Document created, but tags could not be saved. Add them from the document.'
      );
    }
  }

  return { documentId };
}

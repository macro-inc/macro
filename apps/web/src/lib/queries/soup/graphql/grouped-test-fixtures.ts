import type { SoupItemFieldsFragment } from '../../../service-clients/service-storage/graphql/generated/graphql';

export function groupedDocument(
  id: string,
  optionIds = ['todo']
): Extract<SoupItemFieldsFragment, { __typename: 'GraphqlSoupDocument' }> {
  return {
    __typename: 'GraphqlSoupDocument',
    id,
    entityType: 'DOCUMENT',
    displayName: id,
    documentName: id,
    ownerId: 'viewer',
    cacheProjection: null,
    frecencyScore: null,
    fileType: 'md',
    projectId: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    viewedAt: null,
    deletedAt: null,
    subType: { __typename: 'GraphqlTaskSubType', isCompleted: false },
    isFavorited: false,
    notifications: [],
    properties: [
      {
        id: `property-${id}`,
        propertyDefinitionId: 'status-definition',
        displayName: 'Status',
        dataType: 'SELECT_STRING',
        isMultiSelect: true,
        specificEntityType: null,
        isSystem: false,
        isMetadata: false,
        value: { __typename: 'GraphqlSelectOptionPropertyValue', optionIds },
      },
    ],
  };
}

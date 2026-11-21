import type { TagSetResponse } from '../../../src/lib/service-clients/service-properties/generated/schemas/tagSetResponse';
import type { SoupPropertyFieldsFragment } from '../../../src/lib/service-clients/service-storage/graphql/generated/graphql';

export const DOCUMENT_ID = '00000000-0000-4000-8000-000000000001';
export const OTHER_DOCUMENT_ID = '00000000-0000-4000-8000-000000000002';
export const TAG_DEFINITION_ID = '00000000-0000-4000-8000-000000000003';
export const ASSIGNMENT_ID = '00000000-0000-4000-8000-000000000004';
export const DOCS_TAG = '00000000-0000-4000-8000-000000000005';
export const BLUE_TAG = '00000000-0000-4000-8000-000000000006';

export const tagSets: TagSetResponse[] = [
  {
    scope: 'user',
    definition: {
      id: TAG_DEFINITION_ID,
      displayName: 'Tags',
      dataType: 'TAG',
      isMultiSelect: true,
      isMetadata: false,
      isSystem: false,
      scope: 'user',
      user_id: 'functional-viewer',
    },
    options: [
      {
        id: DOCS_TAG,
        propertyDefinitionId: TAG_DEFINITION_ID,
        displayOrder: 0,
        value: { type: 'string', value: 'docs' },
      },
      {
        id: BLUE_TAG,
        propertyDefinitionId: TAG_DEFINITION_ID,
        displayOrder: 1,
        value: { type: 'string', value: 'blue' },
      },
    ],
  },
];

// The same tag sets as the GraphQL `user.tagSets` field returns them.
export const graphqlTagSets = tagSets.map(({ scope, definition, options }) => ({
  scope: scope.toUpperCase(),
  definition: definition && {
    id: definition.id,
    owner: { scope: 'USER', principalId: 'functional-viewer' },
    displayName: definition.displayName,
    dataType: definition.dataType,
    isMultiSelect: definition.isMultiSelect,
    specificEntityType: null,
    isSystem: definition.isSystem,
    isMetadata: definition.isMetadata,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
  options: options.map((option) => ({
    id: option.id,
    propertyDefinitionId: option.propertyDefinitionId,
    displayOrder: option.displayOrder,
    value: {
      __typename: 'GraphqlStringPropertyOptionValue',
      value: option.value.value,
    },
    color: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  })),
}));

export function tagAssignment(optionIds: string[]): SoupPropertyFieldsFragment {
  return {
    id: ASSIGNMENT_ID,
    propertyDefinitionId: TAG_DEFINITION_ID,
    displayName: 'Tags',
    dataType: 'TAG',
    isMultiSelect: true,
    specificEntityType: null,
    isSystem: false,
    isMetadata: false,
    value: optionIds.length
      ? { __typename: 'GraphqlSelectOptionPropertyValue', optionIds }
      : null,
  };
}

export function soupDocument(
  id: string,
  properties: SoupPropertyFieldsFragment[]
) {
  return {
    __typename: 'GraphqlSoupDocument',
    entityType: 'DOCUMENT',
    id,
    displayName: id === DOCUMENT_ID ? 'Task under test' : 'Unrelated task',
    name: id === DOCUMENT_ID ? 'Task under test' : 'Unrelated task',
    ownerId: 'functional-viewer',
    ownerType: 'USER',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    fileType: 'md',
    projectId: null,
    viewedAt: null,
    deletedAt: null,
    subType: { __typename: 'GraphqlTaskSubType', isCompleted: false },
    properties,
    notifications: [],
    isFavorited: false,
    frecencyScore: 0,
    cacheProjection: null,
  };
}

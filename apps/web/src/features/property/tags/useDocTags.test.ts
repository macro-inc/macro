import type { Property } from '@property/types';
import type { PropertyDefinitionDetailResponse } from '@service-properties/generated/schemas/propertyDefinitionDetailResponse';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  properties: vi.fn<() => Property[]>(),
  tagSets: vi.fn<() => TagSetResponse[]>(),
}));

vi.mock('@queries/properties/entity', () => ({
  useBulkUpdateEntityPropertyOptionsMutation: () => ({
    mutateAsync: mocks.mutateAsync,
  }),
}));
vi.mock('@queries/properties/in-flight-options', () => ({
  useInFlightEntityPropertyOptions: () => () => undefined,
}));
vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: () => ({
    get data() {
      return mocks.tagSets();
    },
  }),
  useEnsureTagSetMutation: () => ({}),
}));
vi.mock('../hooks', () => ({
  useEntityProperties: () => ({ properties: mocks.properties }),
}));
vi.mock('./tag-sets-context', () => ({
  useTagSets: () => mocks.tagSets,
}));

import { useDocTags, useSoupDocTags } from './useDocTags';

const definition: PropertyDefinitionDetailResponse = {
  id: 'tag-def',
  displayName: 'Tags',
  dataType: 'TAG',
  isMultiSelect: true,
  isMetadata: false,
  isSystem: false,
  scope: 'system',
};
const property: Property = {
  propertyId: 'assignment-1',
  propertyDefinitionId: definition.id,
  displayName: definition.displayName,
  isMultiSelect: true,
  owner: { scope: 'system' },
  createdAt: '',
  updatedAt: '',
  valueType: 'SELECT_STRING',
  value: ['cool'],
};
const soupProperty: SoupProperty = {
  id: property.propertyId,
  definition: {
    id: definition.id,
    display_name: definition.displayName,
    data_type: 'TAG',
    is_multi_select: true,
    is_metadata: false,
    is_system: false,
    owner: { scope: 'system' },
    created_at: '',
    updated_at: '',
  },
  value: { type: 'SelectOption', value: ['cool'] },
};

let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mutateAsync.mockResolvedValue([]);
  mocks.properties.mockReturnValue([property]);
  mocks.tagSets.mockReturnValue([
    {
      scope: 'user',
      definition,
      options: [
        {
          id: 'cool',
          propertyDefinitionId: definition.id,
          displayOrder: 0,
          value: { type: 'string', value: 'cool' },
        },
      ],
    },
  ]);
});
afterEach(() => dispose?.());

describe('tag assignment identity', () => {
  it.each(['detail', 'soup'] as const)(
    'preserves the %s assignment when removing a tag',
    async (source) => {
      const tags = createRoot((cleanup) => {
        dispose = cleanup;
        return source === 'detail'
          ? useDocTags('doc-1', 'DOCUMENT')
          : useSoupDocTags('doc-1', 'DOCUMENT', () => [soupProperty]);
      });

      expect(tags.isApplied('cool')).toBe(true);
      await tags.removeTag('user', 'cool');
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        entityId: 'doc-1',
        entityType: 'DOCUMENT',
        properties: [
          {
            property: expect.objectContaining({
              id: 'tag-def',
              valueType: 'TAG',
            }),
            assignmentId: 'assignment-1',
            currentOptionIds: ['cool'],
            nextOptionIds: [],
          },
        ],
      });
    }
  );

  it.each(['detail', 'soup'] as const)(
    'reads the latest %s assignment after the first tag is saved',
    async (source) => {
      const [assigned, setAssigned] = createSignal(false);
      mocks.properties.mockImplementation(() => (assigned() ? [property] : []));
      const tags = createRoot((cleanup) => {
        dispose = cleanup;
        return source === 'detail'
          ? useDocTags('doc-1', 'DOCUMENT')
          : useSoupDocTags('doc-1', 'DOCUMENT', () =>
              assigned() ? [soupProperty] : []
            );
      });

      await tags.applyTag('user', 'cool');
      expect(mocks.mutateAsync.mock.calls[0][0].properties[0]).toMatchObject({
        assignmentId: undefined,
        currentOptionIds: [],
        nextOptionIds: ['cool'],
      });

      setAssigned(true);
      await tags.removeTag('user', 'cool');
      expect(mocks.mutateAsync.mock.calls[1][0].properties[0]).toMatchObject({
        assignmentId: 'assignment-1',
        currentOptionIds: ['cool'],
        nextOptionIds: [],
      });
    }
  );
});

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

describe('scoped tag sets', () => {
  const teamDefinition: PropertyDefinitionDetailResponse = {
    ...definition,
    id: 'team-tag-def',
    scope: 'team',
    team_id: 'team-1',
  };
  const teamProperty: Property = {
    ...property,
    propertyId: 'assignment-2',
    propertyDefinitionId: teamDefinition.id,
    value: ['shared'],
  };

  beforeEach(() => {
    mocks.properties.mockReturnValue([property, teamProperty]);
    mocks.tagSets.mockReturnValue([
      ...mocks.tagSets(),
      {
        scope: 'team',
        definition: teamDefinition,
        options: [
          {
            id: 'shared',
            propertyDefinitionId: teamDefinition.id,
            displayOrder: 0,
            value: { type: 'string', value: 'shared' },
          },
        ],
      },
    ]);
  });

  it('shows every scope by default', () => {
    const tags = createRoot((cleanup) => {
      dispose = cleanup;
      return useDocTags('thread-1', 'THREAD');
    });

    expect(tags.scopes).toEqual(['user', 'team']);
    expect(tags.tagSets().map((set) => set.scope)).toEqual(['user', 'team']);
    expect(tags.appliedTags().map((tag) => tag.optionId)).toEqual([
      'cool',
      'shared',
    ]);
  });

  it('hides team tags and their set when limited to personal tags', () => {
    const tags = createRoot((cleanup) => {
      dispose = cleanup;
      return useDocTags('thread-1', 'THREAD', { scopes: ['user'] });
    });

    expect(tags.scopes).toEqual(['user']);
    expect(tags.tagSets().map((set) => set.scope)).toEqual(['user']);
    expect(tags.appliedTags().map((tag) => tag.optionId)).toEqual(['cool']);
    expect(tags.isApplied('shared')).toBe(false);
  });

  it('leaves applied team tags alone when a personal-only selection is saved', async () => {
    const tags = createRoot((cleanup) => {
      dispose = cleanup;
      return useDocTags('thread-1', 'THREAD', { scopes: ['user'] });
    });

    await tags.setTagSelection(new Set());
    expect(mocks.mutateAsync).toHaveBeenCalledOnce();
    expect(mocks.mutateAsync.mock.calls[0][0].properties).toEqual([
      expect.objectContaining({
        assignmentId: 'assignment-1',
        currentOptionIds: ['cool'],
        nextOptionIds: [],
      }),
    ]);
  });

  it('refuses to apply a tag from a hidden scope', async () => {
    const tags = createRoot((cleanup) => {
      dispose = cleanup;
      return useDocTags('thread-1', 'THREAD', { scopes: ['user'] });
    });

    await expect(tags.applyTag('team', 'shared')).rejects.toThrow(
      'not available'
    );
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });
});

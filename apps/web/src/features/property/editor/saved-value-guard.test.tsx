import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SYSTEM_PROPERTY_IDS } from '../constants';
import type {
  Property,
  PropertyDefinitionDomain,
  PropertyOption,
} from '../types';
import { PropertyEditorDialog } from './PropertyEditorModal';
import type {
  PropertyEditorEntity,
  PropertyEditorState,
} from './state/propertyEditor';

type SavedProperties = { data?: Property[]; error?: Error };

const mocks = vi.hoisted(() => ({
  savedProperties: (): { data?: unknown[]; error?: Error } => ({ data: [] }),
  updateOptions: vi.fn(),
  tagSets: [] as unknown[],
}));

vi.mock('@queries/properties/entity', () => ({
  useEntityPropertiesQuery: () => ({
    get data() {
      return mocks.savedProperties().data;
    },
    get error() {
      return mocks.savedProperties().error;
    },
  }),
  useBulkUpdateEntityPropertyOptionsMutation: () => ({
    mutateAsync: mocks.updateOptions,
  }),
  useAddEntityPropertyMutation: () => ({}),
  useDeleteEntityPropertyMutation: () => ({}),
}));
vi.mock('@queries/properties/in-flight-options', () => ({
  useInFlightEntityPropertyOptions: () => () => undefined,
}));
vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: () => ({ isLoading: false, data: mocks.tagSets }),
  useEnsureTagSetMutation: () => ({}),
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ data: undefined }),
}));
vi.mock('@queries/team/members', () => ({
  useTeamMembers: () => ({
    users: () => [],
    isLoading: () => false,
    isError: () => false,
  }),
}));
vi.mock('@queries/contacts/use-directory', () => ({
  usePinnedContactUsers: () => () => [],
}));
vi.mock('../queries/agent-assignees', () => ({
  useAgentAssignees: () => () => [],
}));
vi.mock('./hooks/useEntitiesForProperty', () => ({
  useEntitiesForProperty: (
    property: () => { specificEntityType?: string } | undefined
  ) => ({
    entities: () =>
      property()?.specificEntityType === 'USER'
        ? [userOption('ada'), userOption('bo'), userOption('cy')]
        : [
            companyOption('acme'),
            companyOption('birch'),
            companyOption('cedar'),
          ],
  }),
}));
vi.mock('../hooks/usePropertyEntityDisplay', () => ({
  usePropertyEntityDisplay: () => ({ icon: () => null }),
}));
vi.mock('@property/tags/TagEditorDialog', () => ({
  TagEditorDialog: () => null,
}));

function userOption(id: string) {
  return {
    kind: 'user',
    id,
    data: { id, email: `${id}@example.com`, name: id },
  };
}

function companyOption(id: string) {
  return {
    kind: 'entity',
    id,
    data: { type: 'crm_company', id, name: id, domains: [] },
  };
}

const TASK: PropertyEditorEntity = {
  id: 'task',
  name: 'Task',
  entityType: 'TASK',
};

function option(id: string): PropertyOption {
  return {
    id,
    property_definition_id: 'areas',
    display_order: 0,
    color: null,
    value: { type: 'string', value: id },
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };
}

const AREAS: PropertyDefinitionDomain = {
  id: 'areas',
  displayName: 'Areas',
  valueType: 'SELECT_STRING',
  isMultiSelect: true,
  isMetadata: false,
  isSystem: false,
  owner: { scope: 'team', team_id: 'team' },
  options: [option('design'), option('docs'), option('release')],
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const ASSIGNEES: PropertyDefinitionDomain = {
  ...AREAS,
  id: SYSTEM_PROPERTY_IDS.ASSIGNEES,
  displayName: 'Assignees',
  valueType: 'ENTITY',
  isSystem: true,
  specificEntityType: 'USER',
  options: undefined,
};

const CUSTOMERS: PropertyDefinitionDomain = {
  ...ASSIGNEES,
  id: 'customers',
  displayName: 'Customers',
  isSystem: false,
  specificEntityType: 'COMPANY',
};

const SAVED_AREAS: Property = {
  propertyId: 'areas-on-task',
  propertyDefinitionId: 'areas',
  displayName: 'Areas',
  isMultiSelect: true,
  owner: { scope: 'team', team_id: 'team' },
  options: AREAS.options,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  valueType: 'SELECT_STRING',
  value: ['design', 'docs'],
};

const SAVED_ASSIGNEES: Property = {
  propertyId: 'assignees-on-task',
  propertyDefinitionId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
  displayName: 'Assignees',
  isMultiSelect: true,
  specificEntityType: 'USER',
  owner: { scope: 'system' },
  createdAt: new Date(0),
  updatedAt: new Date(0),
  valueType: 'ENTITY',
  value: [
    { entity_id: 'ada', entity_type: 'USER' },
    { entity_id: 'bo', entity_type: 'USER' },
  ],
};

const SAVED_CUSTOMERS: Property = {
  ...SAVED_ASSIGNEES,
  propertyId: 'customers-on-task',
  propertyDefinitionId: 'customers',
  displayName: 'Customers',
  specificEntityType: 'COMPANY',
  value: [
    { entity_id: 'acme', entity_type: 'COMPANY' },
    { entity_id: 'birch', entity_type: 'COMPANY' },
  ],
};

function open(
  state: Partial<PropertyEditorState>,
  initiallyRead: SavedProperties = {}
) {
  const [savedProperties, setSavedProperties] = createSignal(initiallyRead);
  mocks.savedProperties = savedProperties;
  const onSave = vi.fn();
  render(() => (
    <PropertyEditorDialog
      isOpen
      state={{ mode: 'direct', selectedEntities: [TASK], ...state }}
      onModeChange={() => {}}
      onTargetChange={() => {}}
      onClose={() => {}}
      onSave={onSave}
    />
  ));
  const field = screen.getByRole<HTMLInputElement>('textbox');
  return { onSave, field, setSavedProperties };
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  mocks.savedProperties = () => ({ data: [] });
  mocks.updateOptions.mockReset();
  mocks.tagSets = [];
});

describe.each([
  {
    name: 'a multi-select property',
    definition: AREAS,
    saved: SAVED_AREAS,
    added: 'release',
    keeps: {
      valueType: 'SELECT_STRING',
      values: ['design', 'docs', 'release'],
    },
    removed: 'design',
    leaves: { valueType: 'SELECT_STRING', values: ['docs'] },
  },
  {
    name: 'a property holding several people',
    definition: ASSIGNEES,
    saved: SAVED_ASSIGNEES,
    added: 'cy',
    keeps: {
      valueType: 'ENTITY',
      refs: [
        { entity_id: 'ada', entity_type: 'USER' },
        { entity_id: 'bo', entity_type: 'USER' },
        { entity_id: 'cy', entity_type: 'USER' },
      ],
    },
    removed: 'ada',
    leaves: {
      valueType: 'ENTITY',
      refs: [{ entity_id: 'bo', entity_type: 'USER' }],
    },
  },
  {
    name: 'a property holding several companies',
    definition: CUSTOMERS,
    saved: SAVED_CUSTOMERS,
    added: 'cedar',
    keeps: {
      valueType: 'ENTITY',
      refs: [
        { entity_id: 'acme', entity_type: 'COMPANY' },
        { entity_id: 'birch', entity_type: 'COMPANY' },
        { entity_id: 'cedar', entity_type: 'COMPANY' },
      ],
    },
    removed: 'acme',
    leaves: {
      valueType: 'ENTITY',
      refs: [{ entity_id: 'birch', entity_type: 'COMPANY' }],
    },
  },
])('$name whose saved value has not been read', (scenario) => {
  it('saves nothing until the value arrives, then keeps it', () => {
    const { onSave, field, setSavedProperties } = open({
      targetProperty: scenario.definition,
    });

    fireEvent.keyDown(field, { key: 'Enter' });
    for (const row of screen.queryAllByRole('option')) fireEvent.click(row);
    expect(onSave).not.toHaveBeenCalled();

    setSavedProperties({ data: [scenario.saved] });
    fireEvent.click(
      screen.getByRole('option', { name: new RegExp(scenario.added) })
    );

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]![1]).toEqual(scenario.keeps);
  });

  it('still removes one of the values once they are read', () => {
    const { onSave, setSavedProperties } = open({
      targetProperty: scenario.definition,
    });

    setSavedProperties({ data: [scenario.saved] });
    fireEvent.click(
      screen.getByRole('option', { name: new RegExp(scenario.removed) })
    );

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]![1]).toEqual(scenario.leaves);
  });

  it('saves nothing when reading the item fails', () => {
    const { onSave, field } = open(
      { targetProperty: scenario.definition },
      { error: new Error('refused') }
    );

    fireEvent.keyDown(field, { key: 'Enter' });
    for (const row of screen.queryAllByRole('option')) fireEvent.click(row);

    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('a property that holds one value', () => {
  it('is replaced without waiting for the saved value', () => {
    const { onSave } = open({
      targetProperty: { ...AREAS, isMultiSelect: false },
    });

    fireEvent.click(screen.getByRole('option', { name: /release/ }));

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]![1]).toEqual({
      valueType: 'SELECT_STRING',
      values: ['release'],
    });
  });
});

describe('the tags of an item whose properties have not been read', () => {
  const TAGS = {
    id: 'tags',
    displayName: 'Tags',
    dataType: 'TAG',
    isMultiSelect: true,
    isMetadata: false,
    isSystem: false,
    scope: 'team',
    team_id: 'team',
  };
  const SAVED_TAGS: Property = {
    propertyId: 'tags-on-task',
    propertyDefinitionId: 'tags',
    displayName: 'Tags',
    isMultiSelect: true,
    owner: { scope: 'team', team_id: 'team' },
    createdAt: new Date(0),
    updatedAt: new Date(0),
    valueType: 'SELECT_STRING',
    value: ['launch', 'urgent'],
  };

  function openTags(initiallyRead: SavedProperties = {}) {
    mocks.tagSets = [
      {
        scope: 'team',
        definition: TAGS,
        options: ['launch', 'urgent', 'later'].map((id, index) => ({
          id,
          propertyDefinitionId: 'tags',
          displayOrder: index,
          value: { type: 'string', value: id },
        })),
      },
    ];
    return open({ mode: 'tag', targetProperty: undefined }, initiallyRead);
  }

  it('changes nothing until they arrive, then adds to them', () => {
    const { field, setSavedProperties } = openTags();

    fireEvent.keyDown(field, { key: 'Enter' });
    for (const row of screen.queryAllByRole('option')) fireEvent.click(row);
    expect(mocks.updateOptions).not.toHaveBeenCalled();

    setSavedProperties({ data: [SAVED_TAGS] });
    fireEvent.click(screen.getByRole('option', { name: /later/ }));

    expect(mocks.updateOptions).toHaveBeenCalledOnce();
    expect(mocks.updateOptions.mock.calls[0]![0].properties).toMatchObject([
      {
        currentOptionIds: ['launch', 'urgent'],
        nextOptionIds: ['launch', 'urgent', 'later'],
      },
    ]);
  });

  it('removes an applied tag once they are read', () => {
    const { setSavedProperties } = openTags();

    setSavedProperties({ data: [SAVED_TAGS] });
    fireEvent.click(screen.getByRole('option', { name: /launch/ }));

    expect(mocks.updateOptions).toHaveBeenCalledOnce();
    expect(mocks.updateOptions.mock.calls[0]![0].properties).toMatchObject([
      {
        currentOptionIds: ['launch', 'urgent'],
        nextOptionIds: ['urgent'],
      },
    ]);
  });

  it('changes nothing when reading the item fails', () => {
    const { field } = openTags({ error: new Error('refused') });

    fireEvent.keyDown(field, { key: 'Enter' });
    for (const row of screen.queryAllByRole('option')) fireEvent.click(row);

    expect(mocks.updateOptions).not.toHaveBeenCalled();
  });

  it('keeps tags already read usable when a later read fails', () => {
    openTags({ data: [SAVED_TAGS], error: new Error('offline') });

    fireEvent.click(screen.getByRole('option', { name: /later/ }));

    expect(mocks.updateOptions).toHaveBeenCalledOnce();
    expect(mocks.updateOptions.mock.calls[0]![0].properties).toMatchObject([
      { nextOptionIds: ['launch', 'urgent', 'later'] },
    ]);
  });
});

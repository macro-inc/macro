import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { usePropertySelection } from '@property/hooks/usePropertySelection';
import { toPropertyDefinitionDomain } from '@property/utils/transforms';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  create: vi.fn(),
  properties: vi.fn(),
  failure: vi.fn(),
  listProperties: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock('@core/util/create', () => ({
  createTaskWithInitialSnapshot: mock.create,
}));
vi.mock('@queries/properties/entity', () => ({
  fetchEntityProperties: mock.properties,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mock.failure },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@property/tags', () => ({ useLocalDocTags: vi.fn() }));
vi.mock('@queries/properties/definitions', () => ({
  useListPropertiesQuery: mock.listProperties,
}));
vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: () => ({ isSuccess: true, data: [] }),
}));

import {
  createTaskComposerProperties,
  createTaskWithProperties,
  taskComposerProjectValue,
} from './taskComposerProperties';

afterEach(() => vi.clearAllMocks());

/** The created task's properties as the server reports them. */
function serverProject(projectId: string | undefined) {
  mock.properties.mockResolvedValue(
    projectId
      ? [
          {
            propertyId: 'row',
            propertyDefinitionId: SYSTEM_PROPERTY_IDS.PROJECT,
            displayName: 'Project',
            valueType: 'ENTITY',
            value: [{ entity_id: projectId, entity_type: 'INITIATIVE' }],
            isMultiSelect: false,
            owner: { scope: 'system' },
            createdAt: '1970-01-01',
            updatedAt: '1970-01-01',
          },
        ]
      : []
  );
}

const create = (projectId?: string) =>
  createTaskWithProperties(
    'Ship it',
    '',
    projectId
      ? [[SYSTEM_PROPERTY_IDS.PROJECT, taskComposerProjectValue(projectId)]]
      : [],
    new Map(),
    vi.fn()
  );

it('creates the task with its Project in the one create call', async () => {
  mock.create.mockResolvedValue({ documentId: 'task' });
  serverProject('project');
  expect(await create('project')).toEqual({ documentId: 'task' });
  expect(mock.create).toHaveBeenCalledWith(
    expect.objectContaining({
      propertyValues: [
        {
          propertyId: SYSTEM_PROPERTY_IDS.PROJECT,
          value: {
            type: 'entity_reference',
            reference: { entity_id: 'project', entity_type: 'INITIATIVE' },
          },
        },
      ],
    })
  );
  expect(mock.failure).not.toHaveBeenCalled();
});

it('says so when the created task did not join its project', async () => {
  mock.create.mockResolvedValue({ documentId: 'task' });
  serverProject(undefined);
  expect(await create('project')).toEqual({ documentId: 'task' });
  expect(mock.failure).toHaveBeenCalledWith(
    expect.stringContaining('could not be added to the project')
  );
});

it('skips the check without a project', async () => {
  mock.create.mockResolvedValue({ documentId: 'task' });
  await create();
  expect(mock.properties).not.toHaveBeenCalled();
});

it('confirms creation before waiting for a project membership read', async () => {
  mock.create.mockResolvedValue({ documentId: 'task' });
  const projectRead = Promise.withResolvers<[]>();
  const confirmed = Promise.withResolvers<string>();
  mock.properties.mockReturnValue(projectRead.promise);
  const creating = createTaskWithProperties(
    'Ship it',
    '',
    [[SYSTEM_PROPERTY_IDS.PROJECT, taskComposerProjectValue('project')]],
    new Map(),
    vi.fn(),
    { onCreated: (task) => confirmed.resolve(task.documentId) }
  );
  expect(await confirmed.promise).toBe('task');
  projectRead.resolve([]);
  expect(await creating).toEqual({ documentId: 'task' });
});

import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import {
  taskComposerVisiblePropertyIds,
  taskComposerWritableDefinitions,
  withoutTaskComposerTags,
} from './taskComposerProperties';

function definition(
  id: string,
  overrides: Partial<PropertyDefinition> = {}
): PropertyDefinition {
  return {
    id,
    display_name: id,
    data_type: 'STRING',
    is_metadata: false,
    is_system: false,
    is_multi_select: false,
    specific_entity_type: null,
    owner: { scope: 'system' },
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

it('keeps entity-reference targets while excluding metadata, tags, and database columns', () => {
  const definitions = [
    definition('assignees', {
      data_type: 'ENTITY',
      specific_entity_type: 'USER',
    }),
    definition('companies', {
      data_type: 'ENTITY',
      specific_entity_type: 'COMPANY',
    }),
    definition('contacts', {
      data_type: 'ENTITY',
      specific_entity_type: 'CONTACT',
    }),
    definition('project', {
      data_type: 'ENTITY',
      specific_entity_type: 'INITIATIVE',
    }),
    definition('metadata', { is_metadata: true }),
    definition('tag', { data_type: 'TAG' }),
    definition('tag-set'),
    definition('column', { owner: { scope: 'database', database_id: 'db' } }),
  ];
  expect(
    taskComposerWritableDefinitions(definitions, new Set(['tag-set'])).map(
      (d) => d.id
    )
  ).toEqual(['assignees', 'companies', 'contacts', 'project']);
});

it('keeps context order, ignores unavailable ids and deduplicates selected properties', () => {
  const definitions = [definition('a'), definition('b')];
  expect(
    taskComposerVisiblePropertyIds(
      ['b', 'missing', 'b', 'a'],
      definitions,
      true
    )
  ).toEqual(['b', 'a']);
  expect(taskComposerVisiblePropertyIds([], definitions, true)).toEqual([]);
});

it('keeps Project behind its feature flag', () => {
  const definitions = [definition(SYSTEM_PROPERTY_IDS.PROJECT)];
  expect(
    taskComposerVisiblePropertyIds(
      [SYSTEM_PROPERTY_IDS.PROJECT],
      definitions,
      false
    )
  ).toEqual([]);
});

it('clears tag sets without clearing arbitrary single-select values', () => {
  const values = {
    tag: { valueType: 'SELECT_STRING' as const, values: ['red'] },
    custom: { valueType: 'SELECT_STRING' as const, values: ['active'] },
  };
  expect(withoutTaskComposerTags(values, new Set(['tag']))).toEqual({
    custom: values.custom,
  });
  expect(values.tag.values).toEqual(['red']);
});

it('lets a draft add Project when its preset omits it without changing entity panels', () => {
  createRoot((dispose) => {
    const project = toPropertyDefinitionDomain(
      definition(SYSTEM_PROPERTY_IDS.PROJECT)
    );
    const [existingIds, setExistingIds] = createSignal<string[]>([]);
    const draft = usePropertySelection(
      existingIds,
      () => [project],
      undefined,
      () => true
    );
    const panel = usePropertySelection(
      () => [],
      () => [project]
    );
    expect(draft.filteredProperties()).toEqual([project]);
    expect(panel.filteredProperties()).toEqual([]);
    setExistingIds([project.id]);
    expect(draft.filteredProperties()).toEqual([]);
    dispose();
  });
});

it('converts an arbitrary added single-select property with its definition', async () => {
  mock.create.mockResolvedValue({ documentId: 'task' });
  await createTaskWithProperties(
    'Task',
    '',
    [['custom', { valueType: 'SELECT_STRING', values: ['chosen'] }]],
    new Map([['custom', definition('custom', { data_type: 'SELECT_STRING' })]]),
    vi.fn()
  );
  expect(mock.create).toHaveBeenCalledWith(
    expect.objectContaining({
      propertyValues: [
        {
          propertyId: 'custom',
          value: { type: 'select_option', option_id: 'chosen' },
        },
      ],
    })
  );
});

it('retains a created single-select definition when the definition query fails', async () => {
  mock.create.mockResolvedValue({ documentId: 'task' });
  mock.refetch.mockResolvedValue({
    isError: true,
    error: new Error('Definition refresh failed'),
  });
  mock.listProperties.mockReturnValue({
    isSuccess: false,
    data: [],
    refetch: mock.refetch,
  });
  const created = {
    definition: definition('created-select', { data_type: 'SELECT_STRING' }),
    property_options: [
      {
        id: 'chosen',
        property_definition_id: 'created-select',
        value: { type: 'string' as const, value: 'Chosen' },
        display_order: 0,
        color: null,
        created_at: '',
        updated_at: '',
      },
    ],
  };
  const { composer, dispose } = createRoot((dispose) => ({
    composer: createTaskComposerProperties({
      initialValues: {},
      initialVisiblePropertyIds: [],
      allDefinitions: true,
    }),
    dispose,
  }));

  try {
    await composer.addProperty(created.definition.id, created);
    composer.setPropertyValues(created.definition.id, {
      valueType: 'SELECT_STRING',
      values: ['chosen'],
    });
    expect(composer.properties()[0]).toMatchObject({
      propertyDefinitionId: 'created-select',
      value: ['chosen'],
      isMultiSelect: false,
    });
    await createTaskWithProperties(
      'Task',
      '',
      Object.entries(composer.propertyValues),
      composer.createDefinitions(),
      vi.fn()
    );
    expect(mock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyValues: [
          {
            propertyId: 'created-select',
            value: { type: 'select_option', option_id: 'chosen' },
          },
        ],
      })
    );
    expect(mock.refetch).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});

it('lets the composer own failed-create feedback without silencing other callers', async () => {
  mock.create.mockResolvedValue(null);
  expect(
    await createTaskWithProperties('Draft', '', [], new Map(), vi.fn(), {
      showFailureToast: false,
    })
  ).toBeNull();
  expect(mock.failure).not.toHaveBeenCalled();
  expect(await create()).toBeNull();
  expect(mock.failure).toHaveBeenCalledExactlyOnceWith('Failed to create Task');
});

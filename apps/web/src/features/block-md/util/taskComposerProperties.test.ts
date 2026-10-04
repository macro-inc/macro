import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { afterEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  create: vi.fn(),
  properties: vi.fn(),
  failure: vi.fn(),
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
vi.mock('@queries/properties/definitions', () => ({}));
vi.mock('@queries/properties/tags', () => ({}));

import {
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

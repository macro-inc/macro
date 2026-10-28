import { createSoupEntityRow } from '@app/features/soup/collection/rows';
import { PROPERTY_OPTION_IDS } from '@property/constants';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { boardEntity, boardProperty } from '../tests/task-board-fixture';
import { createTaskBoardQueries } from './task-board-queries';

const fixture = vi.hoisted(() => ({
  definitions: {} as Record<string, unknown>,
  projectQueries: [] as Record<string, unknown>[],
  projectIds: [] as string[],
  save: vi.fn(async (_input: unknown) => {}),
}));

vi.mock('@queries/storage/document-metadata', () => ({
  useDocumentAccessLevelsQuery: () => {
    throw new Error('Task permissions must not be prefetched');
  },
}));
vi.mock('@queries/properties/definitions', () => ({
  useListPropertiesQuery: () => fixture.definitions,
}));
vi.mock('@queries/properties/entity', () => ({
  useBulkSaveEntityPropertiesMutation: () => ({ mutateAsync: fixture.save }),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({}),
}));
vi.mock('@app/features/projects/queries/project-identity', () => ({
  createProjectIdentityQuery: (
    _client: unknown,
    _user: unknown,
    id: () => string
  ) => {
    fixture.projectIds.push(id());
    return (
      fixture.projectQueries[fixture.projectIds.length - 1] ?? {
        isSuccess: false,
      }
    );
  },
}));

const disposers: (() => void)[] = [];

function setup(
  options: Partial<Parameters<typeof createTaskBoardQueries>[0]> = {}
) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    return createTaskBoardQueries({
      rows: () => [createSoupEntityRow(boardEntity('one'))],
      grouping: () => 'status',
      searching: () => false,
      userId: () => 'viewer',
      projectsEnabled: () => true,
      ...options,
    });
  });
}

beforeEach(() => {
  fixture.projectQueries = [];
  fixture.projectIds = [];
  fixture.definitions = {
    isSuccess: false,
    get data() {
      throw new Error('pending data must not be read');
    },
  };
  fixture.save.mockReset();
  fixture.save.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const dispose of disposers) {
    dispose();
  }
  disposers.length = 0;
});

it('allows task editing without a permission prefetch and keeps missing-row guards', () => {
  const source = setup();

  expect(source.actions.canEditTask('one')).toBe(true);
  expect(source.actions.canEditTask('missing')).toBe(false);
  expect(source.canEditProperty('missing', SYSTEM_PROPERTY_IDS.PRIORITY)).toBe(
    false
  );
  expect(fixture.projectIds).toEqual([]);
});

it('blocks overlapping property writes and restores editability when a write fails', async () => {
  fixture.definitions = {
    isSuccess: true,
    data: [
      boardProperty(SYSTEM_PROPERTY_IDS.PRIORITY, null, 'SELECT_STRING')
        .definition,
    ],
  };
  let reject!: (error: Error) => void;
  fixture.save.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      })
  );
  const source = setup();
  const property = source.property('one', SYSTEM_PROPERTY_IDS.PRIORITY)!;
  const values = {
    valueType: 'SELECT_STRING' as const,
    values: [PROPERTY_OPTION_IDS.PRIORITY.HIGH],
  };
  const pending = source.saveProperty('one', property, values);
  const failed = expect(pending).rejects.toThrow('rejected');

  expect(source.actions.canEditTask('one')).toBe(false);
  await expect(source.saveProperty('one', property, values)).rejects.toThrow(
    'no longer editable'
  );
  await expect(
    source.actions.save(
      { id: 'one', fromLane: '', toLane: PROPERTY_OPTION_IDS.PRIORITY.HIGH },
      'priority'
    )
  ).rejects.toThrow('no longer editable');
  reject(new Error('rejected'));
  await failed;

  expect(fixture.save).toHaveBeenCalledOnce();
  expect(source.actions.canEditTask('one')).toBe(true);
});

it('attempts project moves without destination edit access and preserves column labels', async () => {
  fixture.definitions = {
    isSuccess: true,
    data: [boardProperty(SYSTEM_PROPERTY_IDS.PROJECT, null).definition],
  };
  fixture.projectQueries = [
    {
      isSuccess: true,
      data: { id: 'launch', name: 'Launch', access: 'view' },
    },
  ];
  const source = setup({
    grouping: () => 'project',
    rows: () => [
      createSoupEntityRow(boardEntity('one'), { groupId: 'launch' }),
    ],
  });

  expect(source.columns().find((column) => column.id === 'launch')?.label).toBe(
    'Launch'
  );
  expect(fixture.projectIds).toEqual(['launch']);
  expect(source.actions.canMoveTo('project', 'launch')).toBe(true);

  fixture.save.mockRejectedValueOnce(new Error('server rejected'));
  await expect(
    source.actions.save(
      { id: 'one', fromLane: '', toLane: 'launch' },
      'project'
    )
  ).rejects.toThrow('server rejected');
  expect(fixture.save).toHaveBeenCalledOnce();
});

it('releases the property lock after a server rejects a project write', async () => {
  fixture.definitions = {
    isSuccess: true,
    data: [boardProperty(SYSTEM_PROPERTY_IDS.PROJECT, null).definition],
  };
  const source = setup();
  const property = source.property('one', SYSTEM_PROPERTY_IDS.PROJECT)!;
  const values = {
    valueType: 'ENTITY' as const,
    refs: [{ entity_id: 'launch', entity_type: 'INITIATIVE' as const }],
  };
  fixture.save.mockRejectedValueOnce(new Error('server rejected'));

  await expect(source.saveProperty('one', property, values)).rejects.toThrow(
    'server rejected'
  );
  expect(source.actions.canEditTask('one')).toBe(true);
  expect(fixture.save).toHaveBeenCalledOnce();

  await source.saveProperty('one', property, values);
  expect(fixture.save).toHaveBeenCalledTimes(2);
});

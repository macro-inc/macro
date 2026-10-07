import { createSoupEntityRow } from '@app/features/soup/collection/rows';
import { PROPERTY_OPTION_IDS } from '@property/constants';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { boardEntity, boardProperty } from '../tests/task-board-fixture';
import { createTaskBoardQueries } from './task-board-queries';

const fixture = vi.hoisted(() => ({
  definitions: {} as Record<string, unknown>,
  permissions: [] as Record<string, unknown>[],
  ids: undefined as (() => readonly string[]) | undefined,
  save: vi.fn(async (_input: unknown) => {}),
  ensureProject: vi.fn(async (_options: unknown) => ({
    project: { id: 'launch', access: 'edit' },
  })),
}));

vi.mock('@queries/storage/document-metadata', () => ({
  useDocumentAccessLevelsQuery: (ids: () => readonly string[]) => {
    fixture.ids = ids;
    return fixture.permissions;
  },
}));
vi.mock('@queries/properties/definitions', () => ({
  useListPropertiesQuery: () => fixture.definitions,
}));
vi.mock('@queries/properties/entity', () => ({
  useBulkSaveEntityPropertiesMutation: () => ({ mutateAsync: fixture.save }),
}));
vi.mock('@tanstack/solid-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/solid-query')>()),
  useQueries: () => [],
  useQueryClient: () => ({ ensureQueryData: fixture.ensureProject }),
}));
vi.mock('@service-storage/initiative', () => ({ initiativeClient: {} }));
vi.mock('@app/features/projects/queries/project-identity', () => ({
  projectDetailQueryOptions: () => ({}),
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
  fixture.permissions = [
    { isSuccess: true, data: { documentId: 'one', accessLevel: 'edit' } },
  ];
  fixture.definitions = {
    isSuccess: false,
    get data() {
      throw new Error('pending data must not be read');
    },
  };
  fixture.save.mockReset();
  fixture.save.mockResolvedValue(undefined);
  fixture.ensureProject.mockReset();
  fixture.ensureProject.mockResolvedValue({
    project: { id: 'launch', access: 'edit' },
  });
});

afterEach(() => {
  for (const dispose of disposers) {
    dispose();
  }
  disposers.length = 0;
});

it.each(['pending', 'stale'])(
  'deduplicates permission queries and rejects %s permission data',
  (state) => {
    fixture.permissions = [
      state === 'stale'
        ? { isSuccess: true, data: { documentId: 'old', accessLevel: 'owner' } }
        : {
            isSuccess: false,
            get data() {
              throw new Error('pending permission data must not be read');
            },
          },
    ];
    const entity = boardEntity('one');
    const source = setup({
      rows: () => [
        createSoupEntityRow(entity, { groupId: 'a' }),
        createSoupEntityRow(entity, { groupId: 'b' }),
      ],
      grouping: () => 'assignee',
    });

    expect(fixture.ids?.()).toEqual(['one']);
    expect(source.actions.canEditTask('one')).toBe(false);
    expect(source.actions.canMoveTo('assignee', 'b')).toBe(false);
  }
);

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
  reject(new Error('rejected'));
  await failed;

  expect(fixture.save).toHaveBeenCalledOnce();
  expect(source.actions.canEditTask('one')).toBe(true);
});

it('checks project edit access before writing and releases the task lock on rejection', async () => {
  fixture.definitions = {
    isSuccess: true,
    data: [boardProperty(SYSTEM_PROPERTY_IDS.PROJECT, null).definition],
  };
  fixture.ensureProject.mockResolvedValueOnce({
    project: { id: 'launch', access: 'view' },
  });
  const source = setup();

  await expect(
    source.saveProperty(
      'one',
      source.property('one', SYSTEM_PROPERTY_IDS.PROJECT)!,
      {
        valueType: 'ENTITY',
        refs: [{ entity_id: 'launch', entity_type: 'INITIATIVE' }],
      }
    )
  ).rejects.toThrow('not editable');

  expect(fixture.ensureProject).toHaveBeenCalledOnce();
  expect(fixture.save).not.toHaveBeenCalled();
  expect(source.actions.canEditTask('one')).toBe(true);
});

import { createSoupEntityRow } from '@app/features/soup/collection/rows';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { boardEntity, boardProperty } from '../tests/task-board-fixture';
import { createTaskGanttQueries } from './task-gantt-queries';

const fixture = vi.hoisted(() => ({
  definitions: {} as Record<string, unknown>,
  permissions: [
    { isSuccess: true, data: { documentId: 'one', accessLevel: 'edit' } },
  ],
  projects: [] as Record<string, unknown>[],
  save: vi.fn(async (_input: unknown) => {}),
}));
vi.mock('@queries/storage/document-metadata', () => ({
  useDocumentAccessLevelsQuery: () => fixture.permissions,
}));
vi.mock('@queries/properties/definitions', () => ({
  useListPropertiesQuery: () => fixture.definitions,
}));
vi.mock('@queries/properties/entity', () => ({
  useBulkSaveEntityPropertiesMutation: () => ({ mutateAsync: fixture.save }),
}));
vi.mock('@tanstack/solid-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/solid-query')>()),
  useQueries: () => fixture.projects,
}));
vi.mock('@service-storage/initiative', () => ({ initiativeClient: {} }));
vi.mock('@app/features/projects/queries/project-identity', () => ({
  projectDetailQueryOptions: () => ({}),
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));

const disposers: (() => void)[] = [];
const move = { id: 'one', fromGroup: 'alice', toGroup: 'bob' };
function setup(
  overrides: Partial<Parameters<typeof createTaskGanttQueries>[0]> = {}
) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    return createTaskGanttQueries({
      rows: () => [
        createSoupEntityRow(
          boardEntity('one', [
            boardProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
              type: 'EntityReference',
              value: [{ entity_id: 'alice', entity_type: 'USER' }],
            }),
          ]),
          { groupId: 'alice' }
        ),
        { kind: 'group-header', id: 'bob', groupId: 'bob', label: 'Bob' },
      ],
      grouping: () => 'assignee',
      userId: () => 'viewer',
      projectsEnabled: () => true,
      ...overrides,
    });
  });
}
beforeEach(() => {
  fixture.permissions = [
    { isSuccess: true, data: { documentId: 'one', accessLevel: 'edit' } },
  ];
  fixture.definitions = {
    isSuccess: true,
    data: [boardProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES, null).definition],
  };
  fixture.projects = [];
  fixture.save.mockReset();
  fixture.save.mockResolvedValue(undefined);
});
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});

it('rechecks permission and source membership on release instead of trusting the initial gate', async () => {
  const source = setup();
  expect(source.canMove(move)).toBe(true);
  expect(source.canMove({ ...move, fromGroup: 'stale' })).toBe(false);
  fixture.permissions[0].data.accessLevel = 'view';
  await expect(source.moveGroup(move)).rejects.toThrow('no longer editable');
  expect(fixture.save).not.toHaveBeenCalled();
});

it('locks overlapping writes and releases the task after a failed group save', async () => {
  let reject!: (error: Error) => void;
  fixture.save.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      })
  );
  const source = setup();
  const pending = source.moveGroup(move);
  const failed = expect(pending).rejects.toThrow('offline');
  expect(source.canDrag(move.id)).toBe(false);
  await expect(source.moveGroup(move)).rejects.toThrow('no longer editable');
  reject(new Error('offline'));
  await failed;
  expect(source.canDrag(move.id)).toBe(true);
  expect(fixture.save).toHaveBeenCalledOnce();
});

it.each(['none', 'date'] as const)(
  'never edits creation-date groups for %s grouping',
  async (grouping) => {
    const source = setup({ grouping: () => grouping });
    expect(source.canDrag(move.id)).toBe(false);
    await expect(source.moveGroup(move)).rejects.toThrow('no longer editable');
    expect(fixture.save).not.toHaveBeenCalled();
  }
);

it('requires destination project edit access and never reads pending project data', async () => {
  fixture.definitions = {
    isSuccess: true,
    data: [boardProperty(SYSTEM_PROPERTY_IDS.PROJECT, null).definition],
  };
  const project = {
    isSuccess: false,
    get data() {
      throw new Error('pending data');
    },
  };
  fixture.projects = [project];
  const source = setup({
    grouping: () => 'project',
    rows: () => [
      createSoupEntityRow(
        boardEntity('one', [
          boardProperty(SYSTEM_PROPERTY_IDS.PROJECT, {
            type: 'EntityReference',
            value: [{ entity_id: 'alice', entity_type: 'INITIATIVE' }],
          }),
        ]),
        { groupId: 'alice' }
      ),
      { kind: 'group-header', id: 'bob', groupId: 'bob', label: 'Bob' },
    ],
  });
  expect(source.canMove(move)).toBe(false);
  fixture.projects.splice(0, 1, {
    isSuccess: true,
    data: { project: { id: 'bob', access: 'view' } },
  });
  await expect(source.moveGroup(move)).rejects.toThrow('no longer editable');
  fixture.projects.splice(0, 1, {
    isSuccess: true,
    data: { project: { id: 'bob', access: 'edit' } },
  });
  await source.moveGroup(move);
  expect(fixture.save).toHaveBeenCalledOnce();
});

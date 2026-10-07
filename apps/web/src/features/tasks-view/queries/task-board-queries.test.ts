import type { FacetSelection } from '@app/features/soup';
import {
  createSoupEntityRow,
  createSoupGroupHeaderRow,
} from '@app/features/soup/collection/rows';
import { PROPERTY_OPTION_IDS } from '@property/constants';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import type { TaskBoardGrouping } from '../core/task-board';
import { boardEntity, boardProperty } from '../tests/task-board-fixture';
import { createTaskBoardQueries } from './task-board-queries';

const fixture = vi.hoisted(() => ({
  definitions: {} as Record<string, unknown>,
  permissions: [] as Record<string, unknown>[],
  projects: [] as Record<string, unknown>[],
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
  useQueries: () => fixture.projects,
  useQueryClient: () => ({ ensureQueryData: fixture.ensureProject }),
}));

vi.mock('@service-storage/initiative', () => ({ initiativeClient: {} }));

vi.mock('@app/features/projects/queries/project-identity', () => ({
  projectDetailQueryOptions: () => ({}),
}));

beforeEach(() => {
  fixture.permissions = [
    { isSuccess: true, data: { documentId: 'one', accessLevel: 'edit' } },
  ];
  fixture.projects = [];
  fixture.definitions = {
    isSuccess: false,
    get data() {
      throw new Error('pending data must not be read');
    },
  };

  fixture.save.mockClear();
  fixture.ensureProject.mockReset();
  fixture.ensureProject.mockResolvedValue({
    project: { id: 'launch', access: 'edit' },
  });
});

it('deduplicates permission reads and never reads pending query data', () => {
  createRoot((dispose) => {
    try {
      const entity = boardEntity('one');

      fixture.permissions = [
        {
          isSuccess: false,
          get data() {
            throw new Error('pending permission data');
          },
        },
      ];

      const source = createTaskBoardQueries({
        rows: () => [
          createSoupEntityRow(entity, { groupId: 'a' }),
          createSoupEntityRow(entity, { groupId: 'b' }),
        ],
        grouping: () => 'assignee',
        searching: () => false,
        userId: () => 'viewer',
        projectsEnabled: () => true,
      });

      expect(fixture.ids?.()).toEqual(['one']);
      expect(source.actions.canEditTask('one')).toBe(false);
      expect(source.actions.canMoveTo('assignee', 'b')).toBe(false);
    } finally {
      dispose();
    }
  });
});

it('uses the shared mutation, supports unset properties, and propagates write failure', async () => {
  await createRoot(async (dispose) => {
    try {
      const id = SYSTEM_PROPERTY_IDS.PRIORITY;
      const target = PROPERTY_OPTION_IDS.PRIORITY.HIGH;
      const definition = boardProperty(id, null, 'SELECT_STRING').definition;

      fixture.definitions = {
        isSuccess: true,
        data: [
          {
            definition,
            property_options: [
              { id: target, value: { type: 'string', value: 'High' } },
            ],
          },
        ],
      };

      const entity = boardEntity('one');
      const source = createTaskBoardQueries({
        rows: () => [createSoupEntityRow(entity, { groupId: '' })],
        grouping: () => 'priority',
        searching: () => false,
        userId: () => 'viewer',
        projectsEnabled: () => true,
      });

      expect(source.actions.canMoveTo('priority', target)).toBe(true);
      expect(source.actions.canMoveTo('priority', 'not-an-option')).toBe(false);

      await source.actions.save(
        { id: 'one', fromLane: '', toLane: target },
        'priority'
      );

      expect(fixture.save).toHaveBeenCalledWith({
        properties: [
          expect.objectContaining({
            entityId: 'one',
            entityType: 'TASK',
            property: expect.objectContaining({ id }),
            apiValues: { valueType: 'SELECT_STRING', values: [target] },
          }),
        ],
      });

      fixture.save.mockRejectedValueOnce(new Error('rejected'));

      await expect(
        source.actions.save(
          { id: 'one', fromLane: '', toLane: target },
          'priority'
        )
      ).rejects.toThrow('rejected');
    } finally {
      dispose();
    }
  });
});

it('does not borrow cached permissions from an old query identity', () => {
  createRoot((dispose) => {
    try {
      fixture.permissions = [
        { isSuccess: true, data: { documentId: 'old', accessLevel: 'owner' } },
      ];
      const source = createTaskBoardQueries({
        rows: () => [createSoupEntityRow(boardEntity('new'))],
        grouping: () => 'status',
        searching: () => false,
        userId: () => 'viewer',
        projectsEnabled: () => true,
      });

      expect(source.actions.canEditTask('new')).toBe(false);
    } finally {
      dispose();
    }
  });
});

it('requires target project edit access and rejects a lost task permission', async () => {
  await createRoot(async (dispose) => {
    try {
      const [access, setAccess] = createSignal('view');
      const [editable, setEditable] = createSignal(true);

      fixture.projects = [
        {
          isSuccess: true,
          get data() {
            return {
              project: { id: 'launch', name: 'Launch', access: access() },
            };
          },
        },
      ];

      fixture.permissions = [
        {
          isSuccess: true,
          get data() {
            return {
              documentId: 'one',
              accessLevel: editable() ? 'edit' : 'view',
            };
          },
        },
      ];

      fixture.definitions = {
        isSuccess: true,
        data: [boardProperty(SYSTEM_PROPERTY_IDS.PROJECT, null).definition],
      };

      const source = createTaskBoardQueries({
        rows: () => [
          createSoupGroupHeaderRow({ id: 'launch', label: 'launch', count: 0 }),
          createSoupEntityRow(boardEntity('one'), { groupId: '' }),
        ],
        grouping: () => 'project',
        searching: () => false,
        userId: () => 'viewer',
        projectsEnabled: () => true,
      });

      expect(source.actions.canMoveTo('project', 'launch')).toBe(false);
      expect(
        source.columns().find((column) => column.id === 'launch')?.label
      ).toBe('Launch');

      setAccess('edit');

      expect(source.actions.canMoveTo('project', 'launch')).toBe(true);

      await source.actions.save(
        { id: 'one', fromLane: '', toLane: 'launch' },
        'project'
      );

      expect(fixture.save).toHaveBeenCalledWith({
        properties: [
          expect.objectContaining({
            apiValues: {
              valueType: 'ENTITY',
              refs: [{ entity_id: 'launch', entity_type: 'INITIATIVE' }],
            },
          }),
        ],
      });

      fixture.save.mockClear();
      setEditable(false);

      await expect(
        source.actions.save(
          { id: 'one', fromLane: '', toLane: 'launch' },
          'project'
        )
      ).rejects.toThrow('no longer editable');

      expect(fixture.save).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });
});

it('passes reactive facets to the board projection', () => {
  createRoot((dispose) => {
    try {
      const [status, setStatus] = createSignal(['in-progress']);
      const source = createTaskBoardQueries({
        rows: () => [],
        grouping: () => 'status',
        searching: () => false,
        userId: () => 'viewer',
        projectsEnabled: () => true,
        facets: () => ({ status: status() }),
      });

      expect(source.columns().map((column) => column.id)).toEqual([
        PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
      ]);
      expect(source.hiddenColumnCount()).toBe(5);

      setStatus(['completed', 'canceled']);

      expect(source.columns().map((column) => column.id)).toEqual([
        PROPERTY_OPTION_IDS.STATUS.COMPLETED,
        PROPERTY_OPTION_IDS.STATUS.CANCELED,
      ]);
      expect(source.hiddenColumnCount()).toBe(4);

      setStatus([]);

      expect(source.hiddenColumnCount()).toBe(0);
      expect(source.columns()).toHaveLength(6);
    } finally {
      dispose();
    }
  });
});

it('builds editable card properties from existing rows and shared definitions', () => {
  createRoot((dispose) => {
    try {
      const status = boardProperty(
        SYSTEM_PROPERTY_IDS.STATUS,
        {
          type: 'SelectOption',
          value: [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS],
        },
        'SELECT_STRING'
      );
      const priority = boardProperty(
        SYSTEM_PROPERTY_IDS.PRIORITY,
        null,
        'SELECT_STRING'
      );

      fixture.definitions = {
        isSuccess: true,
        data: [status.definition, priority.definition],
      };

      const source = createTaskBoardQueries({
        rows: () => [createSoupEntityRow(boardEntity('one', [status]))],
        grouping: () => 'status',
        searching: () => false,
        userId: () => 'viewer',
        projectsEnabled: () => true,
      });

      expect(source.property('one', SYSTEM_PROPERTY_IDS.STATUS)).toMatchObject({
        value: [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS],
        isRequired: true,
      });
      expect(
        source.property('one', SYSTEM_PROPERTY_IDS.PRIORITY)
      ).toMatchObject({ value: null, valueType: 'SELECT_STRING' });
      expect(source.canEditProperty('one', SYSTEM_PROPERTY_IDS.PRIORITY)).toBe(
        true
      );
      expect(
        source.canEditProperty('missing', SYSTEM_PROPERTY_IDS.PRIORITY)
      ).toBe(false);
    } finally {
      dispose();
    }
  });
});

it('uses shared mutations for pills and prevents overlapping moves while saving', async () => {
  await createRoot(async (dispose) => {
    try {
      fixture.definitions = {
        isSuccess: true,
        data: [
          boardProperty(SYSTEM_PROPERTY_IDS.PRIORITY, null, 'SELECT_STRING')
            .definition,
        ],
      };

      const source = createTaskBoardQueries({
        rows: () => [createSoupEntityRow(boardEntity('one'))],
        grouping: () => 'priority',
        searching: () => false,
        userId: () => 'viewer',
        projectsEnabled: () => true,
      });

      let finish!: () => void;
      fixture.save.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      );

      const property = source.property('one', SYSTEM_PROPERTY_IDS.PRIORITY)!;
      const values = {
        valueType: 'SELECT_STRING' as const,
        values: [PROPERTY_OPTION_IDS.PRIORITY.HIGH],
      };

      const saving = source.saveProperty('one', property, values);

      expect(source.actions.canEditTask('one')).toBe(false);

      await expect(
        source.saveProperty('one', property, values)
      ).rejects.toThrow('no longer editable');

      finish();
      await saving;

      expect(source.actions.canEditTask('one')).toBe(true);
      expect(fixture.save).toHaveBeenCalledWith({
        properties: [
          expect.objectContaining({
            entityId: 'one',
            entityType: 'TASK',
            apiValues: values,
          }),
        ],
      });
    } finally {
      dispose();
    }
  });
});

it('checks a project chosen by a pill before writing and restores editability on failure', async () => {
  await createRoot(async (dispose) => {
    try {
      fixture.definitions = {
        isSuccess: true,
        data: [boardProperty(SYSTEM_PROPERTY_IDS.PROJECT, null).definition],
      };

      const source = createTaskBoardQueries({
        rows: () => [createSoupEntityRow(boardEntity('one'))],
        grouping: () => 'status',
        searching: () => false,
        userId: () => 'viewer',
        projectsEnabled: () => true,
      });

      fixture.ensureProject.mockResolvedValueOnce({
        project: { id: 'launch', access: 'view' },
      });

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
    } finally {
      dispose();
    }
  });
});

it.each<{
  grouping: TaskBoardGrouping;
  facets: FacetSelection;
  hidden: number;
}>([
  { grouping: 'priority', facets: { priority: ['high'] }, hidden: 4 },
  { grouping: 'assignee', facets: { assignees: ['alice'] }, hidden: 2 },
  { grouping: 'project', facets: { project: ['launch'] }, hidden: 2 },
])(
  'counts hidden $grouping columns without hiding columns for unrelated filters',
  ({ grouping, facets, hidden }) => {
    createRoot((dispose) => {
      try {
        const [selection, setSelection] = createSignal<FacetSelection>({
          ...facets,
          status: ['in-progress'],
        });
        const rows =
          grouping === 'priority'
            ? []
            : [
                createSoupGroupHeaderRow({
                  id: grouping === 'assignee' ? 'alice' : 'launch',
                  label: 'Selected',
                  count: 2,
                }),
                createSoupGroupHeaderRow({
                  id: 'other',
                  label: 'Other',
                  count: 3,
                }),
              ];
        const source = createTaskBoardQueries({
          rows: () => rows,
          grouping: () => grouping,
          searching: () => false,
          userId: () => 'viewer',
          projectsEnabled: () => true,
          facets: selection,
        });

        expect(source.columns()).toHaveLength(1);
        expect(source.hiddenColumnCount()).toBe(hidden);

        setSelection({ status: ['in-progress'] });

        expect(source.hiddenColumnCount()).toBe(0);
        expect(source.columns()).toHaveLength(hidden + 1);
      } finally {
        dispose();
      }
    });
  }
);

import type { FacetSelection } from '@app/features/soup/filters/facets/types';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import { TASK_DEFAULT_GROUP_BY } from '../constants';
import { isProjectTab } from '../core/task-navigation';
import type { TasksViewState, TaskTab } from '../types';
import {
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
  TASK_VIEWER,
  type TaskFacetContext,
} from './task-facets';

const personSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('viewer') }).strict(),
  z
    .object({
      type: z.literal('user'),
      id: z
        .string()
        .min(1)
        .max(1024)
        .refine((id) => id !== TASK_VIEWER),
    })
    .strict(),
]);
const identifierSchema = z
  .string()
  .guid()
  .transform((id) => id.toLowerCase());
const idsSchema = z.array(identifierSchema).max(100);
const filtersSchema = z
  .object({
    statusOptionIds: idsSchema,
    priorityOptionIds: idsSchema,
    // Built-in tabs can add the viewer to 100 explicitly selected people.
    assignees: z.array(personSchema).max(101),
    creators: z.array(personSchema).max(101),
    tags: z
      .array(
        z
          .object({
            propertyDefinitionId: identifierSchema,
            optionId: identifierSchema,
          })
          .strict()
      )
      .max(100),
  })
  .strict();
const layoutSchema = z.enum(['list', 'board', 'gantt']);
const groupBySchema = z.enum([
  'none',
  'status',
  'priority',
  'assignee',
  'project',
  'date',
]);
const sortItemSchema = z
  .object({
    id: z.enum(['updated_at', 'created_at', 'viewed_at']),
    reversed: z.boolean().default(false),
  })
  .strict();
const sortSchema = z.array(sortItemSchema).max(3);
const taskSavedViewSchema = z
  .object({
    kind: z.literal('tasks'),
    version: z.literal(1),
    filters: filtersSchema,
    layout: layoutSchema.default('list'),
    groupBy: groupBySchema.default(TASK_DEFAULT_GROUP_BY['team-tasks']),
    sort: sortSchema.default([{ id: 'updated_at', reversed: false }]),
  })
  .strict();
const readableTaskSavedViewSchema = taskSavedViewSchema
  .pick({
    kind: true,
    version: true,
  })
  .extend({ filters: z.record(z.string(), z.unknown()) })
  .loose();
const SAVED_TASK_FACET_IDS: readonly string[] = [
  'status',
  'priority',
  'assignees',
  'created-by',
  'tags',
];

export type TaskSavedViewConfig = z.infer<typeof taskSavedViewSchema>;

function uniqueSorted<T>(values: T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

function canonical(config: TaskSavedViewConfig): TaskSavedViewConfig {
  const filters = config.filters;
  return {
    kind: 'tasks',
    version: 1,
    layout: config.layout,
    groupBy: config.groupBy,
    sort: config.sort.map((item) => ({ ...item, reversed: !!item.reversed })),
    filters: {
      statusOptionIds: uniqueSorted(filters.statusOptionIds, String),
      priorityOptionIds: uniqueSorted(filters.priorityOptionIds, String),
      assignees: uniqueSorted(filters.assignees, JSON.stringify),
      creators: uniqueSorted(filters.creators, JSON.stringify),
      tags: uniqueSorted(filters.tags, (tag) => tag.optionId),
    },
  };
}

/** Rejects unknown fields and ambiguous bindings rather than dropping clauses. */
export function decodeTaskSavedView(
  value: unknown
): Result<TaskSavedViewConfig, string> {
  const parsed = taskSavedViewSchema.safeParse(value);
  if (!parsed.success)
    return err('This view contains unsupported or invalid task filters.');
  const definitions = new Map<string, string>();
  for (const tag of parsed.data.filters.tags) {
    const previous = definitions.get(tag.optionId);
    if (previous && previous !== tag.propertyDefinitionId)
      return err('This view contains conflicting tag filters.');
    definitions.set(tag.optionId, tag.propertyDefinitionId);
  }
  return ok(canonical(parsed.data));
}

export type TaskSavedViewIssue = {
  path: string[];
  message: string;
};

export type TaskSavedViewRead = {
  config: TaskSavedViewConfig;
  issues: TaskSavedViewIssue[];
};

/** Applies understood filters and reports anything omitted from the saved definition. */
export function readTaskSavedView(value: unknown): TaskSavedViewRead {
  const parsed = taskSavedViewSchema.safeParse(value);
  const issues: TaskSavedViewIssue[] = parsed.success
    ? []
    : parsed.error.issues.flatMap((issue) =>
        issue.code === 'unrecognized_keys'
          ? issue.keys.map((key) => ({
              path: [...issue.path.map(String), key],
              message: 'This field is not supported.',
            }))
          : [{ path: issue.path.map(String), message: issue.message }]
      );
  const readable = readableTaskSavedViewSchema.safeParse(value);
  if (!readable.success)
    return {
      issues,
      config: {
        kind: 'tasks',
        version: 1,
        layout: 'list',
        groupBy: TASK_DEFAULT_GROUP_BY['team-tasks'],
        sort: [{ id: 'updated_at', reversed: false }],
        filters: {
          statusOptionIds: [],
          priorityOptionIds: [],
          assignees: [],
          creators: [],
          tags: [],
        },
      },
    };
  const layout = layoutSchema.safeParse(readable.data.layout ?? 'list');
  const groupBy = groupBySchema.safeParse(
    readable.data.groupBy ?? TASK_DEFAULT_GROUP_BY['team-tasks']
  );
  const sort =
    readable.data.sort === undefined
      ? [{ id: 'updated_at' as const, reversed: false }]
      : readSort(readable.data.sort);
  const filters = readable.data.filters;

  function readSort(value: unknown) {
    if (!Array.isArray(value))
      return [{ id: 'updated_at' as const, reversed: false }];
    const supported = value
      .flatMap((item) => {
        const parsed = sortItemSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      })
      .slice(0, 3);
    return value.length && !supported.length
      ? [{ id: 'updated_at' as const, reversed: false }]
      : supported;
  }
  const readEntries = <T>(
    values: unknown,
    item: z.ZodType<T>,
    limit: number
  ): T[] =>
    Array.isArray(values)
      ? uniqueSorted(
          values.flatMap((value) => {
            const parsed = item.safeParse(value);
            return parsed.success ? [parsed.data] : [];
          }),
          JSON.stringify
        ).slice(0, limit)
      : [];
  const tags = readEntries(
    filters.tags,
    filtersSchema.shape.tags.element,
    Number.POSITIVE_INFINITY
  );
  const definitions = new Map<string, Set<string>>();
  for (const tag of tags) {
    const ids = definitions.get(tag.optionId) ?? new Set<string>();
    ids.add(tag.propertyDefinitionId);
    definitions.set(tag.optionId, ids);
  }
  const conflicting = new Set(
    [...definitions].filter(([, ids]) => ids.size > 1).map(([id]) => id)
  );
  if (Array.isArray(filters.tags)) {
    filters.tags.forEach((tag, index) => {
      const parsed = filtersSchema.shape.tags.element.safeParse(tag);
      if (parsed.success && conflicting.has(parsed.data.optionId))
        issues.push({
          path: ['filters', 'tags', String(index)],
          message: 'This tag has conflicting property definitions.',
        });
    });
  }
  return {
    issues,
    config: canonical({
      kind: 'tasks',
      version: 1,
      layout: layout.success ? layout.data : 'list',
      groupBy: groupBy.success
        ? groupBy.data
        : TASK_DEFAULT_GROUP_BY['team-tasks'],
      sort,
      filters: {
        statusOptionIds: readEntries(
          filters.statusOptionIds,
          identifierSchema,
          100
        ),
        priorityOptionIds: readEntries(
          filters.priorityOptionIds,
          identifierSchema,
          100
        ),
        assignees: readEntries(filters.assignees, personSchema, 101),
        creators: readEntries(filters.creators, personSchema, 101),
        tags: tags
          .filter((tag) => !conflicting.has(tag.optionId))
          .slice(0, 100),
      },
    }),
  };
}

const optionId = (id: string, options: typeof TASK_STATUS_OPTIONS): string =>
  options.find((option) => option.id === id)?.propertyOptionId ?? id;

/** Folds a built-in tab into ordinary person alternatives without losing other filters. */
export function withTaskTabFilters(
  tab: TaskTab,
  facets: FacetSelection
): FacetSelection {
  if (tab === 'my-tasks')
    return {
      ...facets,
      assignees: [...new Set([...(facets.assignees ?? []), TASK_VIEWER])],
    };
  if (tab === 'created-by-me')
    return {
      ...facets,
      'created-by': [
        ...new Set([...(facets['created-by'] ?? []), TASK_VIEWER]),
      ],
    };
  return facets;
}

/** Captures filters, layout, grouping, and sort; text search stays local. */
export function captureTaskSavedView(input: {
  tab: TaskTab;
  facets: FacetSelection;
  layout?: TasksViewState['layout'];
  groupBy?: TasksViewState['groupBy'];
  sort?: TasksViewState['sort'];
  context: TaskFacetContext;
}): Result<TaskSavedViewConfig, string> {
  if (isProjectTab(input.tab))
    return err('Open a task list to save its filters.');
  if (
    Object.keys(input.facets).some((id) => !SAVED_TASK_FACET_IDS.includes(id))
  )
    return err('These task filters cannot be saved yet.');
  const tags = [];
  for (const id of input.facets.tags ?? []) {
    const definition = input.context.tagPropertyDefinitionByOptionId.get(id);
    if (!definition)
      return err('A selected tag is unavailable. Remove it before saving.');
    tags.push({ optionId: id, propertyDefinitionId: definition });
  }
  const facets = withTaskTabFilters(input.tab, input.facets);
  const people = (values: string[]) =>
    values.map((id) =>
      id === TASK_VIEWER
        ? { type: 'viewer' as const }
        : { type: 'user' as const, id }
    );
  return decodeTaskSavedView({
    kind: 'tasks',
    version: 1,
    layout: input.layout,
    groupBy: input.groupBy,
    sort: input.sort,
    filters: {
      statusOptionIds: (input.facets.status ?? []).map((id) =>
        optionId(id, TASK_STATUS_OPTIONS)
      ),
      priorityOptionIds: (input.facets.priority ?? []).map((id) =>
        optionId(id, TASK_PRIORITY_OPTIONS)
      ),
      assignees: people(facets.assignees ?? []),
      creators: people(facets['created-by'] ?? []),
      tags,
    },
  });
}

export function materializeTaskSavedView(config: TaskSavedViewConfig): {
  tab: TaskTab;
  facets: FacetSelection;
  tagBindings: ReadonlyMap<string, string>;
  layout: TasksViewState['layout'];
  groupBy: TasksViewState['groupBy'];
  sort: TasksViewState['sort'];
} {
  const filters = config.filters;
  const selectionId = (id: string, options: typeof TASK_STATUS_OPTIONS) =>
    options.find((option) => option.propertyOptionId === id)?.id ?? id;
  const people = (values: TaskSavedViewConfig['filters']['assignees']) =>
    values.map((value) => (value.type === 'viewer' ? TASK_VIEWER : value.id));
  return {
    tab: 'team-tasks',
    layout: config.layout,
    groupBy: config.groupBy,
    sort: config.sort.map((item) => ({ ...item })),
    facets: {
      status: filters.statusOptionIds.map((id) =>
        selectionId(id, TASK_STATUS_OPTIONS)
      ),
      priority: filters.priorityOptionIds.map((id) =>
        selectionId(id, TASK_PRIORITY_OPTIONS)
      ),
      assignees: people(filters.assignees),
      'created-by': people(filters.creators),
      tags: filters.tags.map((tag) => tag.optionId),
    },
    tagBindings: new Map(
      filters.tags.map((tag) => [tag.optionId, tag.propertyDefinitionId])
    ),
  };
}

export function taskSavedViewsEqual(
  left: TaskSavedViewConfig,
  right: TaskSavedViewConfig
): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

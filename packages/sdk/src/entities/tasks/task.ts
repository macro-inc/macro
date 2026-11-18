import type {
  PropertyInput,
  SoupApiItem,
} from '../../../generated/storage/types.gen';
import {
  type IterationOptions,
  iterate,
  MacroError,
  paginate,
  unwrap,
} from '../../utils';
import type { MacroClient } from '../../utils/client';
import { rejectUnknownOptions } from '../../utils/options';
import { Document } from '../documents/document';
import type { Initiative } from '../initiatives/initiative';
import type { Project } from '../projects/project';
import { entitySearch } from '../search/options';
import { Team } from '../teams/team';
import { User } from '../users/user';
import { WorkspaceQuery } from '../workspace/query';

/**
 * System task property definitions and Status options. Values mirror
 * `SystemPropertyKey` and `StatusOption` in the backend's `system_properties`
 * crate.
 */
const ASSIGNEES_PROPERTY_ID = '00000001-0000-0000-0000-000000000001';
const STATUS_PROPERTY_ID = '00000001-0000-0000-0000-000000000002';
const DUE_DATE_PROPERTY_ID = '00000001-0000-0000-0000-000000000004';
const PROJECT_PROPERTY_ID = '00000001-0000-0000-0000-000000000014';
const NOT_STARTED_STATUS_OPTION_ID = '00000001-0000-0000-0002-000000000001';
const COMPLETED_STATUS_OPTION_ID = '00000001-0000-0000-0002-000000000004';

/** A task's name and state from one batched read, without its content. */
export interface TaskSummary {
  task: Task;
  name: string;
  owner: User;
  updatedAt?: string;
  completed: boolean;
}

/** A task's Status. */
export type TaskStatus =
  | 'not_started'
  | 'in_progress'
  | 'in_review'
  | 'completed'
  | 'canceled';

/** The system Status options, by name. */
const STATUS_OPTION_IDS: Record<TaskStatus, string> = {
  not_started: NOT_STARTED_STATUS_OPTION_ID,
  in_progress: '00000001-0000-0000-0002-000000000002',
  in_review: '00000001-0000-0000-0002-000000000003',
  completed: COMPLETED_STATUS_OPTION_ID,
  canceled: '00000001-0000-0000-0002-000000000005',
};

/** The Statuses of a task still to do, as the app's Tasks view counts them. */
const OPEN_STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'in_review'];

/** Filters for {@link Task.list}. */
export interface TaskListOptions extends IterationOptions {
  /** Whose tasks: those assigned to this user. Defaults to you. */
  assignee?: User;
  /** Only tasks due at or after this instant. */
  dueAfter?: Date;
  /** Only tasks due before this instant (exclusive). */
  dueBefore?: Date;
  /** Only tasks with one of these Statuses. Defaults to the open ones: not_started, in_progress and in_review. */
  status?: TaskStatus[];
}

/** A task with the name, due date and Status its listing already carries. */
export interface TaskListing {
  task: Task;
  name: string;
  /** When it is due, as an ISO 8601 instant; `undefined` when it has no due date. */
  dueDate: string | undefined;
  status: TaskStatus | undefined;
}

/** The `owner/repo/pull/number` key of a GitHub pull request URL. */
function pullRequestKey(url: string): string {
  const match = url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]*)\/?(?:[?#].*)?$/i,
  );
  if (!match) {
    throw new Error(
      `Expected a GitHub pull request URL like https://github.com/owner/repo/pull/1, got ${url}`,
    );
  }
  return `${match[1]}/${match[2]}/pull/${match[3]}`;
}

/** An existing task that looks like the same work as a proposed one. */
export interface SimilarTask {
  /** The existing task. */
  task: Task;
  /** The existing task's name. */
  name: string;
  /** Cosine similarity of the two tasks' embeddings, from 0 to 1. */
  similarity: number;
}

/**
 * A Macro task: a document with sub-type `task`, so every `Document` method
 * works on it, including `content` and `edit` for its body. Inherits the full
 * document surface ({@link Document.rename}, move, delete, restore, events)
 * and adds task-specific state.
 */
export class Task extends Document {
  /** A handle to a task by document id. Details load on first access. */
  static byId(client: MacroClient, id: string): Task {
    return new Task(client, id);
  }

  /**
   * Create a task, with its initiative, assignees and due date in the same
   * request. The task starts Not started.
   */
  static async create(
    client: MacroClient,
    opts: {
      name: string;
      markdown?: string;
      /** Folder the task document is filed in; unrelated to `initiative`. */
      project?: Project;
      /** The initiative (shown as the task's Project in the app) it belongs to. */
      initiative?: Initiative;
      /** Assignees; defaults to the creator. Pass `[]` to leave it unassigned. */
      assignees?: User[];
      dueDate?: Date;
      /** Scopes the team task number; may be omitted when the creator belongs to exactly one team. */
      team?: Team;
      /** Defaults to true. */
      shareWithTeam?: boolean;
    },
  ): Promise<Task> {
    if (typeof opts !== 'object' || opts === null)
      throw new MacroError(
        'tasks.create takes an options object, { name, markdown, ... }.',
      );
    rejectUnknownOptions('tasks.create', opts, {
      name: true,
      markdown: true,
      project: true,
      initiative: true,
      assignees: true,
      dueDate: true,
      team: true,
      shareWithTeam: true,
    });
    if (typeof opts.name !== 'string' || !opts.name.trim())
      throw new MacroError('tasks.create needs `name`, the task title.');
    const { documentId } = unwrap(
      await client.storage.createTaskHandler({
        body: {
          taskName: opts.name,
          markdown: opts.markdown ?? null,
          projectId: opts.project?.id ?? null,
          teamId: opts.team?.id ?? null,
          shareWithTeam: opts.shareWithTeam ?? true,
          propertyValues: await initialProperties(client, opts),
        },
      }),
    );
    return new Task(client, documentId);
  }

  /**
   * Names and state of many tasks in one request, in the order given. Tasks
   * that no longer exist are left out.
   */
  static async summaries(
    client: MacroClient,
    tasks: Task[],
  ): Promise<TaskSummary[]> {
    if (tasks.length === 0) return [];
    const { previews } = unwrap(
      await client.storage.getBatchPreviewHandler({
        body: { document_ids: tasks.map((task) => task.id) },
      }),
    );
    const found = new Map(
      previews.flatMap((preview) =>
        preview.type === 'access' ? [[preview.document_id, preview]] : [],
      ),
    );
    return tasks.flatMap((task) => {
      const preview = found.get(task.id);
      if (!preview) return [];
      return [
        {
          task,
          name: preview.document_name,
          owner: User.byId(client, preview.owner),
          updatedAt: preview.updated_at ?? undefined,
          completed:
            preview.sub_type?.type === 'task' && preview.sub_type.is_completed,
        },
      ];
    });
  }

  /**
   * Existing tasks of the caller or their team that look like the same work
   * as a task with this title and body, most similar first. Creates and
   * changes nothing; check it before creating a task.
   */
  static async findSimilar(
    client: MacroClient,
    opts: { title: string; body?: string },
  ): Promise<SimilarTask[]> {
    if (typeof opts !== 'object' || opts === null)
      throw new MacroError(
        'tasks.findSimilar takes an options object, { title, body }.',
      );
    rejectUnknownOptions('tasks.findSimilar', opts, {
      title: true,
      body: true,
    });
    if (typeof opts.title !== 'string' || !opts.title.trim())
      throw new MacroError(
        'tasks.findSimilar needs `title`, the title of the task you would create.',
      );
    const { results } = unwrap(
      await client.storage.taskSimilaritySearchHandler({
        body: { taskName: opts.title, markdown: opts.body ?? null },
      }),
    );
    return results.map((result) => ({
      task: new Task(client, result.taskId),
      name: result.taskName,
      similarity: result.vectorScore,
    }));
  }

  /**
   * The tasks the GitHub pull request at `url` references (as `MACRO-<id>` in
   * its text, branch, or comments), oldest link first. Empty when the caller
   * cannot see the pull request; tasks the caller cannot open still appear.
   */
  static async forPullRequest(
    client: MacroClient,
    url: string,
  ): Promise<Task[]> {
    const githubKey = pullRequestKey(url);
    const { pullRequests } = unwrap(
      await client.storage.getGithubPullRequestTasks({
        body: { githubKeys: [githubKey] },
      }),
    );
    return (pullRequests[0]?.taskIds ?? []).map((id) => new Task(client, id));
  }

  /**
   * Open tasks assigned to a user (you by default) that match every given
   * filter, soonest due first and those with no due date last: the query the
   * app's Tasks view runs for its My tasks tab.
   */
  static list(
    client: MacroClient,
    options: TaskListOptions = {},
  ): AsyncGenerator<TaskListing> {
    if (typeof options !== 'object' || options === null)
      throw new MacroError(
        'tasks.list takes an options object, { assignee, dueAfter, dueBefore, status }.',
      );
    for (const [name, value] of [
      ['dueAfter', options.dueAfter],
      ['dueBefore', options.dueBefore],
    ] as const) {
      if (
        value !== undefined &&
        !(value instanceof Date && Number.isFinite(value.getTime()))
      )
        throw new MacroError(`tasks.list: \`${name}\` must be a valid Date.`);
    }
    if (
      options.status !== undefined &&
      (!Array.isArray(options.status) ||
        options.status.length === 0 ||
        options.status.some(
          (status) => !Object.hasOwn(STATUS_OPTION_IDS, status),
        ))
    )
      throw new MacroError(
        `tasks.list: \`status\` must be a non-empty list of ${Object.keys(STATUS_OPTION_IDS).join(', ')}.`,
      );
    return iterate(
      'tasks.list',
      options,
      { assignee: true, dueAfter: true, dueBefore: true, status: true },
      () => listPages(client, options),
    );
  }

  /**
   * Whether the task is completed (its Status property is "Completed");
   * `undefined` if the document is not a task.
   *
   * @readonly
   */
  async completed(): Promise<boolean | undefined> {
    const { subType } = await this.detail.get();
    if (subType !== 'task') return undefined;
    const properties = await this.properties();
    const value = properties.find(
      (p) => p.definition.id === STATUS_PROPERTY_ID,
    )?.value;
    return (
      value?.type === 'SelectOption' &&
      value.value.includes(COMPLETED_STATUS_OPTION_ID)
    );
  }

  /**
   * The task's team slug, such as `DB-245`, the short name to put in git
   * branch names. It is the slug of the team the task is numbered in, then
   * the task's number in that team; `documents.byTeamSlug` resolves a slug of
   * the caller's current team back to its task. `undefined` when the task has
   * no team number, or that team is not one of the caller's. `branchName()`
   * suggests a whole branch name, but takes its prefix from the caller's first
   * team, so it can differ from this slug.
   *
   * @readonly
   */
  async slug(): Promise<string | undefined> {
    const { teamId, teamTaskId } = await this.detail.get();
    if (!teamId || !teamTaskId) return undefined;

    const teams = await Team.list(this.client);
    const taskTeam = teams.find((team) => team.id === teamId);
    if (!taskTeam) return undefined;

    return `${await taskTeam.slug()}-${teamTaskId}`;
  }

  /**
   * The task's URL in the Macro web app.
   *
   * @readonly
   */
  override webUrl(): string {
    return `${this.client.webAppUrl}/app/task/${this.id}`;
  }

  /** Search tasks by name and content, most relevant first, auto-paginated; `maxItems` caps the total. */
  static search = entitySearch({
    filters: { document_filters: { sub_types: ['task'], task_filters: {} } },
    type: 'document',
    make: (client, hit) => new Task(client, hit.document_id),
    listWith: 'macro.tasks.list',
  });
}

/**
 * Property values for a new task, or `null` to keep the service's defaults
 * (creator assigned, Not started). Sending any value replaces those defaults,
 * so the defaults are spelled out here.
 */
async function initialProperties(
  client: MacroClient,
  opts: Parameters<typeof Task.create>[1],
): Promise<PropertyInput[] | null> {
  if (!opts.initiative && !opts.assignees && !opts.dueDate) return null;
  const assignees = opts.assignees ?? [await User.me(client)];
  const values: PropertyInput[] = [
    {
      propertyId: STATUS_PROPERTY_ID,
      value: { type: 'select_option', option_id: NOT_STARTED_STATUS_OPTION_ID },
    },
  ];
  if (assignees.length > 0) {
    values.push({
      propertyId: ASSIGNEES_PROPERTY_ID,
      value: {
        type: 'multi_entity_reference',
        references: assignees.map((user) => ({
          entity_id: user.id,
          entity_type: 'USER',
        })),
      },
    });
  }
  if (opts.initiative) {
    values.push({
      propertyId: PROJECT_PROPERTY_ID,
      value: {
        type: 'entity_reference',
        reference: { entity_id: opts.initiative.id, entity_type: 'INITIATIVE' },
      },
    });
  }
  if (opts.dueDate) {
    values.push({
      propertyId: DUE_DATE_PROPERTY_ID,
      value: { type: 'date', value: opts.dueDate.toISOString() },
    });
  }
  return values;
}

/** A Soup filter expression. */
type Filter = Record<string, unknown>;

const all = (filters: Filter[]): Filter =>
  filters.reduce((left, right) => ({ '&': [left, right] }));

const any = (filters: Filter[]): Filter =>
  filters.reduce((left, right) => ({ '|': [left, right] }));

/**
 * The pages of {@link Task.list}: the Tasks view's My tasks query (Assignees,
 * Status and Due date property filters over task documents), soonest due
 * first.
 */
async function* listPages(
  client: MacroClient,
  options: TaskListOptions,
): AsyncGenerator<TaskListing> {
  const assignee = options.assignee ?? (await User.me(client));
  const filters: Filter[] = [
    { l: { pd: ASSIGNEES_PROPERTY_ID, v: { er: assignee.id } } },
    any(
      (options.status ?? OPEN_STATUSES).map((status) => ({
        l: { pd: STATUS_PROPERTY_ID, v: { so: STATUS_OPTION_IDS[status] } },
      })),
    ),
  ];
  if (options.dueAfter || options.dueBefore)
    filters.push({
      l: {
        pd: DUE_DATE_PROPERTY_ID,
        et: 'TASK',
        v: {
          dr: {
            start: options.dueAfter?.toISOString(),
            end: options.dueBefore?.toISOString(),
          },
        },
      },
    });
  const body = await new WorkspaceQuery(client).body({
    includeTypes: ['document'],
    df: { l: { dst: 'task' } },
    propf: all(filters),
    limit: 100,
  });
  body.sort_method = 'property';
  body.sort_property_definition_id = DUE_DATE_PROPERTY_ID;
  body.sort_direction = 'asc';
  const items = paginate<SoupApiItem>(async (cursor) => {
    const page = unwrap(
      await client.storage.postItemsSoupAst({
        body,
        query: cursor ? { cursor } : undefined,
      }),
    );
    return { items: page.items, nextCursor: page.next_cursor };
  });
  for await (const item of items) {
    if (item.tag !== 'document') continue;
    const value = (property: string) =>
      item.data.properties.find((each) => each.definition.id === property)
        ?.value;
    const due = value(DUE_DATE_PROPERTY_ID);
    const status = value(STATUS_PROPERTY_ID);
    const statusId =
      status?.type === 'SelectOption' ? status.value[0] : undefined;
    yield {
      task: Task.byId(client, item.data.id),
      name: item.data.name,
      dueDate: due?.type === 'Date' ? due.value : undefined,
      status: (Object.keys(STATUS_OPTION_IDS) as TaskStatus[]).find(
        (name) => STATUS_OPTION_IDS[name] === statusId,
      ),
    };
  }
}

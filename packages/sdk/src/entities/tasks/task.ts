import type { PropertyInput } from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Document } from '../documents/document';
import type { Initiative } from '../initiatives/initiative';
import type { Project } from '../projects/project';
import { entitySearch } from '../search';
import type { Team } from '../teams/team';
import { User } from '../users/user';

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

/**
 * A Macro task: a document with sub-type `task`. Inherits the full document
 * surface ({@link Document.rename}, move, delete, restore, content, events)
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
   * Whether the task is completed (its Status property is "Completed");
   * `undefined` if the document is not a task.
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

  /** The task's URL in the Macro web app. */
  override webUrl(): string {
    return `${this.client.webAppUrl}/app/task/${this.id}`;
  }

  /** Search tasks by name and content, most relevant first, auto-paginated. */
  static search = entitySearch({
    filters: { document_filters: { sub_types: ['task'], task_filters: {} } },
    type: 'document',
    make: (client, hit) => new Task(client, hit.document_id),
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

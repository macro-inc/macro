import { match } from 'ts-pattern';
import type {
  EntityReference,
  PropertyInput,
} from '../../../generated/storage/types.gen';
import { MacroError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { rejectUnknownOptions } from '../../utils/options';
import type { Message } from '../channels/message';
import type { Chat } from '../chats/chat';
import { Document } from '../documents/document';
import type { Initiative } from '../initiatives/initiative';
import type { Project } from '../projects/project';
import { entitySearch } from '../search/options';
import { Team } from '../teams/team';
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
const SOURCE_PROPERTY_ID = '00000001-0000-0000-0000-00000000000b';
const NOT_STARTED_STATUS_OPTION_ID = '00000001-0000-0000-0002-000000000001';
const COMPLETED_STATUS_OPTION_ID = '00000001-0000-0000-0002-000000000004';

/** What a task was created from: the message, document or chat it came out of. */
export type TaskSource = Message | Document | Chat;

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
      /** Defaults to team sharing, or private when the session cannot share. */
      shareWithTeam?: boolean;
      /** What the task came from; linked as a chip above `markdown` and set as its Source. A team bot with no acting user can't pass it yet. */
      source?: TaskSource;
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
      source: true,
    });
    if (typeof opts.name !== 'string' || !opts.name.trim())
      throw new MacroError('tasks.create needs `name`, the task title.');
    const source = opts.source && sourceReference(opts.source);
    // A reply's chip opens its thread only with the thread id, which
    // `channel.message(id)` hasn't loaded yet; `content()` loads the whole
    // message (messages are never seeded from listings).
    if (opts.source?.entityType === 'channel_message')
      await opts.source.content();
    const { documentId } = unwrap(
      await client.storage.createTaskHandler({
        body: {
          taskName: opts.name,
          markdown: taskBody(opts.markdown, opts.source),
          projectId: opts.project?.id ?? null,
          teamId: opts.team?.id ?? null,
          shareWithTeam: opts.shareWithTeam,
          propertyValues: await initialProperties(client, opts, source),
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
  });
}

/** The Source property's reference to a task's source; throws for anything else. */
function sourceReference(source: TaskSource): EntityReference {
  // Code-mode programs are untyped, so `source` can be anything, including a
  // handle's JSON, which has an `entityType` but no `toMention`.
  if (typeof source?.toMention !== 'function') return notASource();
  return match<TaskSource, EntityReference>(source)
    .with({ entityType: 'channel_message' }, (message) => ({
      entity_id: message.channelId,
      entity_type: 'CHANNEL',
      specific_message_id: message.id,
    }))
    .with({ entityType: 'document' }, (document) => ({
      entity_id: document.id,
      entity_type: 'DOCUMENT',
    }))
    .with({ entityType: 'chat' }, (chat) => ({
      entity_id: chat.id,
      entity_type: 'CHAT',
    }))
    .otherwise(notASource);
}

function notASource(): never {
  throw new MacroError(
    'tasks.create takes `source` as a channel message, document or chat handle, e.g. `channel.message(id)`.',
  );
}

/** The task body: a chip linking its source, then the caller's markdown. */
function taskBody(
  markdown: string | undefined,
  source: TaskSource | undefined,
): string | null {
  if (!source) return markdown ?? null;
  const link = `Source: ${source.toMention().tag}`;
  return markdown ? `${link}\n\n${markdown}` : link;
}

/**
 * Property values for a new task, or `null` to keep the service's defaults
 * (creator assigned, Not started). Sending any value replaces those defaults,
 * so the defaults are spelled out here.
 */
async function initialProperties(
  client: MacroClient,
  opts: Parameters<typeof Task.create>[1],
  source: EntityReference | undefined,
): Promise<PropertyInput[] | null> {
  if (!opts.initiative && !opts.assignees && !opts.dueDate && !source)
    return null;
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
  if (source) {
    values.push({
      propertyId: SOURCE_PROPERTY_ID,
      value: { type: 'entity_reference', reference: source },
    });
  }
  return values;
}

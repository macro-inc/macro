import type { MacroClient } from '../../utils/client';
import type { Initiative } from '../initiatives/initiative';
import type { Project } from '../projects/project';
import type { SearchOpts } from '../search';
import type { Team } from '../teams/team';
import type { User } from '../users/user';
import { type SimilarTask, Task, type TaskSummary } from './task';

/**
 * Tasks: one `create` call sets initiative, assignees and due date; one
 * `summaries` call reads many names (`name()` loads each whole document).
 * Creating a task needs only what the request states; don't research what it
 * describes unless asked.
 */
export class TaskNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to a task by document id. Details load on first access. */
  byId(id: string): Task {
    return Task.byId(this.client, id);
  }

  /**
   * Create a task, with its initiative, assignees and due date in the same
   * request. The task starts Not started. Call `findSimilar` first in the
   * same program; if a likely duplicate exists, skip this and return the
   * matches.
   */
  create(opts: {
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
  }): Promise<Task> {
    return Task.create(this.client, opts);
  }

  /**
   * Names and state of many tasks in one request, in the order given. Tasks
   * that no longer exist are left out.
   */
  summaries(tasks: Task[]): Promise<TaskSummary[]> {
    return Task.summaries(this.client, tasks);
  }

  /**
   * Check similar existing tasks in the same program as `create`. Returns yours
   * or your team's tasks that look like this title and body, most similar first.
   * If one is a likely duplicate, return the matches and do not create; never
   * edit, merge or delete them unless the user asks.
   *
   * ```js
   * const similar = await macro.tasks.findSimilar({ title, body });
   * if (similar.length > 0) {
   *   return { data: { created: false, similar: similar.map((item) => ({
   *     id: item.task.id, name: item.name, url: item.task.webUrl(),
   *     similarity: item.similarity,
   *   })) } };
   * }
   * const task = await macro.tasks.create({ name: title, markdown: body });
   * return { data: { created: true, id: task.id, url: task.webUrl() } };
   * ```
   */
  findSimilar(opts: { title: string; body?: string }): Promise<SimilarTask[]> {
    return Task.findSimilar(this.client, opts);
  }

  /**
   * The tasks the GitHub pull request at `url` references, oldest link first.
   */
  forPullRequest(url: string): Promise<Task[]> {
    return Task.forPullRequest(this.client, url);
  }

  /** Search tasks by name and content, most relevant first, auto-paginated. */
  search(query: string, opts?: SearchOpts): AsyncGenerator<Task> {
    return Task.search(this.client, query, opts);
  }
}

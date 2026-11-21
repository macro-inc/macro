import type { MacroClient } from '../../utils/client';
import type { Initiative } from '../initiatives/initiative';
import type { Project } from '../projects/project';
import type { SearchOpts } from '../search/options';
import type { Team } from '../teams/team';
import type { User } from '../users/user';
import { type SimilarTask, Task, type TaskSummary } from './task';

/**
 * Tasks: one `create` call sets initiative, assignees and due date; one
 * `summaries` call reads many names (`name()` loads each whole document).
 * Creating a task needs only what the request states; don't research what it
 * describes unless asked.
 *
 * @routing Use when creating, assigning or updating tasks, reporting on open or overdue tasks, or managing reusable task templates; not reminders, which are routines.
 *
 * @agent
 * Never edit, merge or delete the tasks `findSimilar` matches unless the user asks.
 * When changing both of a task's dates, set the Due Date before the Start Date:
 * a start after the current due date is saved as that due date.
 */
export class TaskNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to a task by document id. Details load on first access. */
  byId(id: string): Task {
    return Task.byId(this.client, id);
  }

  /**
   * Create a task, with its initiative, assignees, start and due dates in the
   * same request. The task starts Not started.
   *
   * @write
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
    /** The day the task is due, kept as a whole day. */
    dueDate?: Date;
    /**
     * The day work on the task starts, kept as a whole day. A start after
     * `dueDate` is saved as the due date.
     */
    startDate?: Date;
    /** Scopes the team task number; may be omitted when the creator belongs to exactly one team. */
    team?: Team;
    /** Defaults to team sharing, or private when the session cannot share. */
    shareWithTeam?: boolean;
  }): Promise<Task> {
    return Task.create(this.client, opts);
  }

  /**
   * Names and state of many tasks in one request, in the order given. Tasks
   * that no longer exist are left out.
   *
   * @readonly
   */
  summaries(tasks: Task[]): Promise<TaskSummary[]> {
    return Task.summaries(this.client, tasks);
  }

  /**
   * Existing tasks like a task with this `title` and `body` (not `create`'s
   * `name` and `markdown`), yours or your team's, most similar first. Call it
   * in the same program as `create`: create only when nothing is a likely
   * duplicate, and otherwise return the matches and ask the user instead of
   * creating.
   *
   * @readonly
   */
  findSimilar(opts: { title: string; body?: string }): Promise<SimilarTask[]> {
    return Task.findSimilar(this.client, opts);
  }

  /**
   * The tasks the GitHub pull request at `url` references, oldest link first.
   *
   * @readonly
   */
  forPullRequest(url: string): Promise<Task[]> {
    return Task.forPullRequest(this.client, url);
  }

  /**
   * Search tasks by name and content, most relevant first, auto-paginated; `maxItems` caps the total.
   *
   * @readonly
   */
  search(query: string, opts?: SearchOpts): AsyncGenerator<Task> {
    return Task.search(this.client, query, opts);
  }
}

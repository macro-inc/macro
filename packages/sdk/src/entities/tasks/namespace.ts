import type { MacroClient } from '../../utils/client';
import type { Initiative } from '../initiatives/initiative';
import type { Project } from '../projects/project';
import type { SearchOpts } from '../search/options';
import type { Team } from '../teams/team';
import type { User } from '../users/user';
import {
  type SimilarTask,
  Task,
  type TaskListing,
  type TaskListOptions,
  type TaskSummary,
} from './task';

/**
 * Tasks: one `create` call sets initiative, assignees and due date; one
 * `summaries` call reads many names (`name()` loads each whole document);
 * one `list` iteration finds a person's open tasks by due date, with their
 * names. Creating a task needs only what the request states; don't research
 * what it describes unless asked.
 *
 * @routing Use when creating, assigning or updating tasks, or finding or reporting on tasks such as open, overdue or soon-due ones; not reminders, which are routines.
 *
 * @agent
 * Never edit, merge or delete the tasks `findSimilar` matches unless the user asks.
 */
export class TaskNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to a task by document id. Details load on first access. */
  byId(id: string): Task {
    return Task.byId(this.client, id);
  }

  /**
   * Create a task, with its initiative, assignees and due date in the same
   * request. The task starts Not started.
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
   * Open tasks assigned to you, or to `assignee`, soonest due first; filter
   * by due date with `dueAfter` (inclusive) and `dueBefore` (exclusive), both
   * instants. Each listing carries the task's name, due date and Status, so
   * it needs no other read. `status` lists the Statuses to include instead of
   * the open ones (not_started, in_progress, in_review). This is the app's
   * My tasks: assigned to the person, whoever created the task. Iterate with
   * `for await`; `maxItems` caps the total.
   *
   * @example Your open tasks due in the next seven days
   * ```js
   * const now = new Date();
   * for await (const { task, name, dueDate } of macro.tasks.list({
   *   dueAfter: now,
   *   dueBefore: new Date(now.getTime() + 7 * 86_400_000),
   * })) {
   *   console.log(name, dueDate, task.webUrl());
   * }
   * ```
   *
   * @readonly
   */
  list(options?: TaskListOptions): AsyncGenerator<TaskListing> {
    return Task.list(this.client, options);
  }

  /**
   * Search tasks by name and content, most relevant first, auto-paginated;
   * `maxItems` caps the total. `query` needs at least one word: to list tasks
   * by assignee, due date or Status, use `list`.
   *
   * @readonly
   */
  search(query: string, opts?: SearchOpts): AsyncGenerator<Task> {
    return Task.search(this.client, query, opts);
  }
}

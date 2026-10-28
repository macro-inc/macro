import type { MacroClient } from '../../utils/client';
import type { SearchOpts } from '../search';
import { Task, type TaskOptions, type TaskSummary } from './task';

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
   * request. The task starts Not started.
   */
  create(opts: TaskOptions): Promise<Task> {
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

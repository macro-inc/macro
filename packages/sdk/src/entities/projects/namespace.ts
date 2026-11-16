import type { MacroClient } from '../../utils/client';
import type { SearchOpts } from '../search/options';
import { Project } from './project';

/**
 * Projects are folders that hold documents, chats and other projects.
 *
 * An agent session cannot be placed in a project: sessions have no project,
 * and `Project.items()` never lists them. To keep a session with a project's
 * work, create a Markdown document in the project that links the session with
 * an agent session chip; `"expanded": true` shows the card that follows its
 * latest turn.
 *
 * @example Link an agent session from a project.
 * ```js
 * const chip = JSON.stringify({ id: session.id, label: '', expanded: true });
 * const document = await macro.documents.create({
 *   name: 'Agent work',
 *   project,
 *   markdown: `<m-agent-session-mention>${chip}</m-agent-session-mention>`,
 * });
 * return { data: { url: document.webUrl() } };
 * ```
 *
 * @routing Use when organizing items into projects (folders); not initiatives, which group tasks.
 */
export class ProjectNamespace {
  constructor(private readonly client: MacroClient) {}

  byId(id: string): Project {
    return Project.byId(this.client, id);
  }

  /**
   * Create a project, optionally nested inside a parent project.
   *
   * @write
   */
  create(opts: { name: string; parent?: Project }): Promise<Project> {
    return Project.create(this.client, opts);
  }

  /**
   * Search projects by name and content, most relevant first, auto-paginated.
   *
   * @readonly
   */
  search(query: string, opts?: SearchOpts): AsyncGenerator<Project> {
    return Project.search(this.client, query, opts);
  }
}

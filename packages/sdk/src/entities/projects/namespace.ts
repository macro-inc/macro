import type { MacroClient } from '../../utils/client';
import type { SearchOpts } from '../search/options';
import { Project } from './project';

/**
 * @routing Use when organizing items into projects (folders); not initiatives, which group tasks.
 */
export class ProjectNamespace {
  constructor(private readonly client: MacroClient) {}

  byId(id: string): Project {
    return Project.byId(this.client, id);
  }

  create(opts: { name: string; parent?: Project }): Promise<Project> {
    return Project.create(this.client, opts);
  }

  search(query: string, opts?: SearchOpts): AsyncGenerator<Project> {
    return Project.search(this.client, query, opts);
  }
}

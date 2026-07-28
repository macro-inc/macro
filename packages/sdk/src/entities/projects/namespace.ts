import type { MacroClient } from '../../utils/client';
import type { SearchOpts } from '../search';
import { Project } from './project';

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

import type {
  GetProjectContentHandlerResponses,
  GetProjectHandlerResponses,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { PropertiedEntity } from '../entity';
import { entitySearch } from '../search';

type ProjectDetail = GetProjectHandlerResponses[200]['data']['projectMetadata'];
type ProjectItem =
  GetProjectContentHandlerResponses[200]['data'][number]['item'];

/** A Macro project: a folder-like container for documents, chats, and subprojects. */
export class Project extends PropertiedEntity<ProjectDetail> {
  /** Favorites identify projects as `project`. */
  readonly entityType = 'project';

  /** The properties service identifies projects as `PROJECT`. */
  protected readonly propertyEntityType = 'PROJECT';

  protected async fetch(): Promise<ProjectDetail> {
    const { data } = unwrap(
      await this.client.storage.getProjectHandler({
        path: { id: this.id },
      }),
    );
    return data.projectMetadata;
  }

  /** A handle to a project by id. Details load on first access. */
  static byId(client: MacroClient, id: string): Project {
    return new Project(client, id);
  }

  /** Create a project, optionally nested inside a parent project. */
  static async create(
    client: MacroClient,
    opts: { name: string; parent?: Project },
  ): Promise<Project> {
    const { data } = unwrap(
      await client.storage.createProjectHandler({
        body: {
          name: opts.name,
          projectParentId: opts.parent?.id ?? null,
        },
      }),
    );
    return new Project(client, data.id, data);
  }

  /** The project's display name. */
  readonly name = this.field('name');

  /** The parent project, if this project is nested. */
  readonly parent = this.mappedField('parentId', (id) =>
    id ? Project.byId(this.client, id) : undefined,
  );

  /** When the project was created (RFC 3339 timestamp). */
  readonly createdAt = this.field('createdAt');

  /** The items (documents, chats, subprojects) directly inside this project. */
  async items(): Promise<ProjectItem[]> {
    const { data } = unwrap(
      await this.client.storage.getProjectContentHandler({
        path: { id: this.id },
      }),
    );
    return data.map((entry) => entry.item);
  }

  /** Rename the project. */
  async rename(name: string): Promise<void> {
    await this.mutate((c) =>
      c.storage.editProjectV2({
        path: { id: this.id },
        body: { name },
      }),
    );
  }

  /**
   * Delete the project and its contents. Soft by default (reversible with
   * {@link restore}); pass `permanent: true` to delete irreversibly.
   */
  async delete(opts?: { permanent?: boolean }): Promise<void> {
    await this.mutate<unknown>((c) =>
      opts?.permanent
        ? c.storage.permanentlyDeleteProject({ path: { id: this.id } })
        : c.storage.deleteProjectHandler({ path: { id: this.id } }),
    );
  }

  /** Restore a soft-deleted project. */
  async restore(): Promise<void> {
    await this.mutate((c) =>
      c.storage.revertDeleteProject({ path: { id: this.id } }),
    );
  }

  /** Search projects by name and content, most relevant first, auto-paginated. */
  static search = entitySearch({
    filters: { project_filters: {} },
    type: 'project',
    make: (client, hit) => new Project(client, hit.id),
  });
}

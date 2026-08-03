import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Document } from '../documents/document';
import type { Project } from '../projects/project';
import { entitySearch } from '../search';
import type { Team } from '../teams/team';

/**
 * The system Status property definition and its "Completed" option. Values
 * mirror `SystemPropertyKey::STATUS_UUID` and `StatusOption::COMPLETED_UUID`
 * in the backend's `system_properties` crate.
 */
const STATUS_PROPERTY_ID = '00000001-0000-0000-0000-000000000002';
const COMPLETED_STATUS_OPTION_ID = '00000001-0000-0000-0002-000000000004';

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
   * Create a task. `team` scopes the team task number and may be omitted
   * when the creator belongs to exactly one team; `shareWithTeam` defaults
   * to true.
   */
  static async create(
    client: MacroClient,
    opts: {
      name: string;
      markdown?: string;
      project?: Project;
      team?: Team;
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
        },
      }),
    );
    return new Task(client, documentId);
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

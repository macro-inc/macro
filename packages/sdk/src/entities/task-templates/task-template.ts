import type {
  SetPropertyValue,
  TaskTemplateConfiguration,
  TaskTemplate as TaskTemplateRecord,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { PropertyDefinition } from '../properties/property-definition';
import { Team } from '../teams/team';
import { User } from '../users/user';

/** A selected property and its optional reusable default value. */
export interface TaskTemplateProperty {
  /** Property definition to show in the composer, even without a default. */
  property: PropertyDefinition;
  /** Omit this to leave the property blank. */
  defaultValue?: SetPropertyValue;
}

/** Content for a new personal or team-owned task template. */
export interface CreateTaskTemplateOptions {
  /** Client-generated UUID; reuse the key and input when retrying creation. */
  idempotencyKey?: string;
  /** Template name. */
  name: string;
  /** Default task title, separate from the template name. */
  title?: string;
  /** Default task sharing, independent of the template's owning team. */
  shareWithTeam?: boolean;
  /** Description Markdown inserted into a blank task description. */
  descriptionMarkdown?: string;
  /** Selected fields and optional default values. */
  properties?: readonly TaskTemplateProperty[];
  /** Omit for a personal template; team templates stay with this team. */
  team?: Team;
}

/** Replacement fields for a task template; omitted fields stay unchanged. */
export interface UpdateTaskTemplateOptions {
  /** Replacement template name. */
  name?: string;
  /** Replacement default task title; an empty string clears the default. */
  title?: string;
  /** Replacement task-sharing default; omission keeps the saved value. */
  shareWithTeam?: boolean;
  /** Replacement description Markdown. */
  descriptionMarkdown?: string;
  /** Replacement selected fields and defaults; an empty array removes all fields. */
  properties?: readonly TaskTemplateProperty[];
}

function configuration(
  fields: readonly TaskTemplateProperty[],
  descriptionMarkdown: string,
  title?: string,
  shareWithTeam?: boolean,
): TaskTemplateConfiguration {
  return {
    title,
    shareWithTeam,
    propertyIds: fields.map((field) => field.property.id),
    defaults: fields.flatMap((field) =>
      field.defaultValue === undefined
        ? []
        : [{ propertyId: field.property.id, value: field.defaultValue }],
    ),
    descriptionMarkdown,
  };
}

/** Personal or team-owned task defaults; existing tasks never change with a template. */
export class TaskTemplate extends MacroEntity<TaskTemplateRecord> {
  /** A template handle; detail loads on first access using current permissions. */
  static byId(client: MacroClient, id: string): TaskTemplate {
    return new TaskTemplate(client, id);
  }

  protected async fetch(): Promise<TaskTemplateRecord> {
    return unwrap(
      await this.client.storage.getTaskTemplate({ path: { id: this.id } }),
    );
  }

  /** List personal templates and, when supplied, a current team's templates. */
  static async list(
    client: MacroClient,
    opts?: { team?: Team },
  ): Promise<TaskTemplate[]> {
    const records = unwrap(
      await client.storage.listTaskTemplates({
        query: { teamId: opts?.team?.id },
      }),
    );
    return records.map((record) => new TaskTemplate(client, record.id, record));
  }

  /** Create a personal template, or a team-owned template while currently a member. */
  static async create(
    client: MacroClient,
    opts: CreateTaskTemplateOptions,
  ): Promise<TaskTemplate> {
    const record = unwrap(
      await client.storage.createTaskTemplate({
        body: {
          id: opts.idempotencyKey,
          name: opts.name,
          teamId: opts.team?.id,
          configuration: configuration(
            opts.properties ?? [],
            opts.descriptionMarkdown ?? '',
            opts.title,
            opts.shareWithTeam,
          ),
        },
      }),
    );
    return new TaskTemplate(client, record.id, record);
  }

  /** The template's name. */
  readonly name = this.field('name');

  /** Default task title, separate from the template name; absent when not configured. */
  readonly title = this.mappedField(
    'configuration',
    (value) => value.title ?? undefined,
  );

  /** Default task sharing; absent means leave the composer's current choice unchanged. */
  readonly shareWithTeam = this.mappedField(
    'configuration',
    (value) => value.shareWithTeam ?? undefined,
  );

  /** Whether the current actor can update or delete this template. */
  readonly canManage = this.field('canManage');

  /** Revision read with the template; stale writes fail rather than overwrite changes. */
  readonly revision = this.field('revision');

  /** Original creator, absent after that account is deleted. */
  readonly creator = this.mappedField('creatorId', (id) =>
    id ? User.byId(this.client, id) : undefined,
  );

  /** Personal owner; absent for team-owned templates. */
  readonly owner = this.mappedField('userId', (id) =>
    id ? User.byId(this.client, id) : undefined,
  );

  /** Owning team; absent for personal templates. */
  readonly team = this.mappedField('teamId', (id) =>
    id ? Team.byId(this.client, id) : undefined,
  );

  /** Description Markdown used only when the current task description is blank. */
  readonly descriptionMarkdown = this.mappedField(
    'configuration',
    (value) => value.descriptionMarkdown,
  );

  /** Selected property handles and their optional defaults, including blank fields. */
  async properties(): Promise<TaskTemplateProperty[]> {
    const { configuration: value } = await this.detail.get();
    const defaults = new Map(
      value.defaults?.map((item) => [item.propertyId, item.value]),
    );
    return value.propertyIds.map((id) => ({
      property: PropertyDefinition.byId(this.client, id),
      defaultValue: defaults.get(id),
    }));
  }

  /** Update a managed template; after a revision conflict, read a fresh handle before retrying. */
  async update(opts: UpdateTaskTemplateOptions): Promise<void> {
    const current = await this.detail.get();
    await this.mutate((client) =>
      client.storage.updateTaskTemplate({
        path: { id: this.id },
        body: {
          revision: current.revision,
          name: opts.name ?? current.name,
          configuration:
            opts.properties === undefined
              ? {
                  ...current.configuration,
                  title: opts.title ?? current.configuration.title,
                  shareWithTeam:
                    opts.shareWithTeam ?? current.configuration.shareWithTeam,
                  descriptionMarkdown:
                    opts.descriptionMarkdown ??
                    current.configuration.descriptionMarkdown,
                }
              : configuration(
                  opts.properties,
                  opts.descriptionMarkdown ??
                    current.configuration.descriptionMarkdown,
                  opts.title ?? current.configuration.title ?? undefined,
                  opts.shareWithTeam ??
                    current.configuration.shareWithTeam ??
                    undefined,
                ),
        },
      }),
    );
  }

  /** Delete a managed template at its observed revision without deleting any created tasks. */
  async delete(): Promise<void> {
    const current = await this.detail.get();
    await this.mutate((client) =>
      client.storage.deleteTaskTemplate({
        path: { id: this.id },
        query: { revision: current.revision },
      }),
    );
  }
}

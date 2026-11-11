import type { MacroClient } from '../../utils/client';
import type { Team } from '../teams/team';
import { type CreateTaskTemplateOptions, TaskTemplate } from './task-template';

/** Personal and team task templates: reusable fields, task title, and description Markdown. */
export class TaskTemplateNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A template handle; detail loads lazily using current account and team permissions. */
  byId(id: string): TaskTemplate {
    return TaskTemplate.byId(this.client, id);
  }

  /**
   * List personal templates and, when supplied, a current team's templates.
   *
   * @readonly
   */
  list(opts?: { team?: Team }): Promise<TaskTemplate[]> {
    return TaskTemplate.list(this.client, opts);
  }

  /**
   * Create a personal template or a template owned by a current team.
   *
   * @write
   */
  create(opts: CreateTaskTemplateOptions): Promise<TaskTemplate> {
    return TaskTemplate.create(this.client, opts);
  }
}

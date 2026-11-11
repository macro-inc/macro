import type { InitiativePageRow } from '../../../generated/storage/types.gen';
import { paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { User } from '../users/user';
import { Initiative, type InitiativeOptions } from './initiative';
import {
  type InitiativePriority,
  type InitiativeStatus,
  optionName,
  PRIORITY_OPTION_IDS,
  STATUS_OPTION_IDS,
} from './options';

export type { InitiativePriority, InitiativeStatus } from './options';

/** An initiative with the name and update time its listing already carries. */
export interface InitiativeSummary {
  initiative: Initiative;
  name: string;
  updatedAt: string;
}

/** Filters and order for {@link InitiativeNamespace.list}. */
export interface InitiativeListOptions {
  /** Case-insensitive substring of the name. */
  query?: string;
  /** Only initiatives with this Status. */
  status?: InitiativeStatus;
  /** Only initiatives with this Priority. */
  priority?: InitiativePriority;
  /** Only initiatives assigned to this user. */
  assignee?: User;
  /** Only initiatives due at or after this time. */
  dueAfter?: Date;
  /** Only initiatives due at or before this time. */
  dueBefore?: Date;
  /** Order by last update (the default), name, or due date with undated last. */
  sort?: 'updated' | 'name' | 'due';
  /** Descending order; defaults to newest first for `updated`, ascending otherwise. */
  descending?: boolean;
  /** Page size, 1 through 100; defaults to 50. Iteration still covers every match. */
  limit?: number;
}

/** An initiative with its canonical properties and progress, as one listing row. */
export interface InitiativeListing {
  initiative: Initiative;
  name: string;
  updatedAt: string;
  /** The caller's access. */
  accessLevel: InitiativePageRow['userAccessLevel'];
  status: InitiativeStatus | undefined;
  priority: InitiativePriority | undefined;
  /** Assigned users, independent of sharing membership. */
  assignees: User[];
  dueDate: string | undefined;
  /** Whether the Status counts as complete. */
  completed: boolean;
  /** Tasks in the initiative that the caller can view. */
  taskCount: number;
  /** Of those, the completed ones. */
  completedTaskCount: number;
}

/**
 * Initiatives in the caller's workspace; filter them by name, status,
 * priority, assignee or due date with one `list()` iteration, which also
 * carries each one's name, properties and task progress.
 *
 * @routing Use when grouping tasks and members into initiatives, finding initiatives by status, priority, assignee or due date, or reading an initiative's description, tasks or discussion; not a single task.
 */
export class InitiativeNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Construct a lazy initiative handle. */
  byId(id: string): Initiative {
    return Initiative.byId(this.client, id);
  }

  /**
   * Initiatives the caller can view that match every given filter, with their
   * name, Status, Priority, assignees, due date and progress over the tasks the
   * caller can view; most recently updated first unless `sort` says otherwise.
   * Iterate with `for await`; pages load as the loop advances.
   *
   * @readonly
   */
  async *list(
    options: InitiativeListOptions = {},
  ): AsyncGenerator<InitiativeListing> {
    const query = {
      query: options.query,
      status: options.status && STATUS_OPTION_IDS[options.status],
      priority: options.priority && PRIORITY_OPTION_IDS[options.priority],
      assignee: options.assignee?.id,
      dueAfter: options.dueAfter?.toISOString(),
      dueBefore: options.dueBefore?.toISOString(),
      sort: options.sort,
      descending: options.descending,
      limit: options.limit,
    };
    const rows = paginate<InitiativePageRow>(async (cursor) => {
      const page = unwrap(
        await this.client.storage.pageInitiatives({
          query: { ...query, cursor },
        }),
      );
      return { items: page.initiatives, nextCursor: page.nextCursor };
    });
    for await (const row of rows) {
      yield {
        initiative: Initiative.byId(this.client, row.id),
        name: row.name,
        updatedAt: row.updatedAt,
        accessLevel: row.userAccessLevel,
        status: optionName(STATUS_OPTION_IDS, 'Status', row.properties.status),
        priority: optionName(
          PRIORITY_OPTION_IDS,
          'Priority',
          row.properties.priority,
        ),
        assignees: row.properties.assignees.map((id) =>
          User.byId(this.client, id),
        ),
        dueDate: row.properties.dueDate ?? undefined,
        completed: row.properties.completed,
        taskCount: row.taskCount,
        completedTaskCount: row.completedTaskCount,
      };
    }
  }

  /**
   * Every accessible initiative with its name, in one request.
   *
   * @readonly
   */
  async summaries(): Promise<InitiativeSummary[]> {
    return unwrap(await this.client.storage.listInitiatives()).initiatives.map(
      (i) => ({
        initiative: Initiative.byId(this.client, i.id),
        name: i.name,
        updatedAt: i.updatedAt,
      }),
    );
  }

  /**
   * Create an initiative.
   *
   * @write
   */
  async create(options: InitiativeOptions): Promise<Initiative> {
    return Initiative.from(
      this.client,
      unwrap(
        await this.client.storage.createInitiative({
          body: {
            name: options.name,
            description: options.description,
            memberIds: options.members?.map((u) => u.id),
            shareWithTeam: options.shareWithTeam,
            propertyValues: options.propertyValues,
          },
        }),
      ),
    );
  }
}

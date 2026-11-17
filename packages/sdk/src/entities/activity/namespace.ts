import type {
  ToolActivityAction,
  ToolActivityEvent,
} from '../../../generated/cognition/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { EntityReference } from '../reference';
import { User } from '../users/user';
import { activityEntity } from './entity';

/** What an activity event did; property changes carry readable `propertyName` and option labels. */
export type ActivityAction = ToolActivityAction;

/** One action attributed to the acting user. */
export interface ActivityEvent {
  /** Who mechanically acted: the user, or an agent acting for them. */
  actor: User;
  /** The kind of item acted on, e.g. `document`, `channel`, `email_thread`. */
  entityType: string;
  /** The item acted on; `undefined` for kinds without a standalone handle (channel messages, database rows). */
  entity: EntityReference | undefined;
  /** What was done. */
  action: ActivityAction;
  /** When it happened, RFC 3339. */
  occurredAt: string;
}

/** A bounded slice of the acting user's activity. */
export interface ActivityRange {
  /** Matching events, newest first, at most 100. */
  activities: ActivityEvent[];
  /** More than 100 events matched; narrow the range to see the rest. */
  truncated: boolean;
}

/**
 * The acting user's own action history across Macro.
 *
 * @routing Use when reading what the user did, opened, edited or sent in a time range, or a teammate's or project's history; not everything that changed in the workspace (`macro.workspace`).
 *
 * @agent `macro.activity.mine` lists the user's own raw actions (opened,
 * edited, sent), including actions agents took for them; `User.activity`
 * reads privacy-reviewed daily, weekly and monthly summaries of the user's
 * or a teammate's work; `Initiative.activity` reads one project's history.
 * Answer with item names and readable property labels, never ids:
 * read names through the returned handles. A range returns at most 100
 * events; when `truncated` is true, split the range and read each part.
 */
export class ActivityNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * The acting user's actions in `[from, to)`, newest first, at most 100; when
   * `truncated` is true, split the range and read each part.
   *
   * @example
   * const to = new Date();
   * const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
   * const { activities, truncated } = await macro.activity.mine({ from, to });
   *
   * @readonly
   */
  async mine(range: {
    from: Date | string;
    to: Date | string;
  }): Promise<ActivityRange> {
    const response = unwrap(
      await this.client.cognition.readMyActivity({
        query: {
          from: timestamp(range.from),
          to: timestamp(range.to),
        },
      }),
    );
    return {
      activities: response.activities.map((event) =>
        activityEvent(this.client, event),
      ),
      truncated: response.truncated,
    };
  }
}

function activityEvent(
  client: MacroClient,
  event: ToolActivityEvent,
): ActivityEvent {
  return {
    actor: User.byId(client, event.actorId),
    entityType: event.entityType,
    entity: activityEntity(client, event.entityType, event.entityId),
    action: event.action,
    occurredAt: event.occurredAt,
  };
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

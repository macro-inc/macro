import type { UserName } from '../../../generated/auth/types.gen';
import type {
  Activity,
  AgentSpendResponse,
  SpendBucket,
} from '../../../generated/cognition/types.gen';
import type {
  AgentRoutine as AgentRoutineRecord,
  TriggerKind,
} from '../../../generated/scheduled-action/types.gen';
import { type Mentionable, type MentionPart, wrapXml } from '../../mentions';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Channel } from '../channels/channel';
import { PropertiedEntity } from '../entity';
import { Routine } from '../routines/routine';
import { type ProfilePicture, toProfilePicture } from './profile-picture';

/** A privacy-reviewed summary of a user's professional work over one period. */
export type ActivityReport = Activity;

/** The UTC period one bucket of {@link User.spend} covers. */
export type AgentSpendBucket = SpendBucket;

/** An agent account's AI spend, summed per bucket, from {@link User.spend}. */
export type AgentSpend = AgentSpendResponse;
/** What starts a routine: a schedule, Macro events, one time, or several. */
export type AgentRoutineTriggerKind = TriggerKind;

/**
 * One of an agent account's routines, from {@link User.routines}: its
 * schedule state and last outcome, never its steps or results.
 */
export type AgentRoutineSummary = {
  /** The routine; only the agent itself can read its detail. */
  routine: Routine;
  /** Display name. */
  name: string;
  /** Whether it runs on its own; paused routines still list. */
  enabled: boolean;
  /** A run is in progress right now. */
  running: boolean;
  /** What starts it. */
  triggerKind: AgentRoutineTriggerKind;
  /** The next scheduled run; absent for event routines and finished one-time ones. */
  nextRunAt: string | undefined;
  /** The latest finished run, absent when it never ran. */
  lastRun:
    | { startedAt: string; endedAt: string; succeeded: boolean }
    | undefined;
};

/** An agent account's routines, from {@link User.routines}. */
export type AgentRoutineList = {
  /** Top-level routines, oldest first, at most 50. */
  routines: AgentRoutineSummary[];
  /** True when the agent has more routines than were listed. */
  truncated: boolean;
};

/**
 * A Macro user. Identity lives in the auth service, so details like the
 * display name are fetched on demand. Can be dropped into a {@link msg}
 * template to @-mention the user.
 */
export class User extends PropertiedEntity<UserName> implements Mentionable {
  /** Favorites identify users as `user`. */
  readonly entityType = 'user';

  /** The properties service identifies users as `USER`. */
  protected readonly propertyEntityType = 'USER';

  protected async fetch(): Promise<UserName> {
    const { names } = unwrap(
      await this.client.auth.getUserNamesWithEmail({
        body: { user_ids: [this.id] },
      }),
    );
    const entry = names.find((n: UserName) => n.id === this.id);
    if (!entry) throw new MacroNotFoundError(`user ${this.id} not found`);
    return entry;
  }

  /** A handle to a user by id. */
  static byId(client: MacroClient, id: string): User {
    return new User(client, id);
  }

  /** A user handle seeded with an already loaded auth-service name. */
  static fromName(client: MacroClient, name: UserName): User {
    return new User(client, name.id, name);
  }

  /** A handle to the current authenticated user. */
  static async me(client: MacroClient): Promise<User> {
    const { user_id } = unwrap(await client.auth.getUserInfo());
    return new User(client, user_id);
  }

  /**
   * This user's display name, fetched from the auth service (falling back to
   * your email contacts when the Macro profile has none).
   *
   * @returns The full name, or `undefined` if the user has no name on record.
   *
   * @readonly
   */
  async name(): Promise<string | undefined> {
    const entry = await this.detail.get();
    const full = [entry.first_name, entry.last_name].filter(Boolean).join(' ');
    return full || undefined;
  }

  /**
   * This user's current profile picture. Reads the auth service every time,
   * so it reflects a recent change.
   *
   * A picture set through Macro is a `StaticImage`; an older picture stored as
   * a bare URL is an `ExternalProfilePicture`. For many users at once use
   * `macro.users.profilePictures`.
   *
   * @returns The picture, or `undefined` if the user has none.
   *
   * @readonly
   */
  async profilePicture(): Promise<ProfilePicture | undefined> {
    const { pictures } = unwrap(
      await this.client.auth.postProfilePictures({
        body: { user_id_list: [this.id] },
      }),
    );
    return toProfilePicture(
      this.client,
      pictures.find((p) => p.id === this.id),
    );
  }

  /**
   * Whether this user is an agent account rather than a person.
   *
   * @returns `true` for an agent account.
   *
   * @readonly
   */
  async isAgent(): Promise<boolean> {
    const entry = await this.detail.get();
    return entry.is_agent === true;
  }

  /**
   * This user's email address. Macro user ids encode it as `macro|<email>`,
   * so this reads straight off the id — no auth-service endpoint returns
   * emails for arbitrary users.
   *
   * @returns The email, or `undefined` if the id is not email-derived.
   *
   * @readonly
   */
  email(): string | undefined {
    const email = this.id.startsWith('macro|') ? this.id.slice(6) : undefined;
    return email?.includes('@') ? email : undefined;
  }

  /**
   * Open (or create) your 1:1 direct-message channel with this user. For a
   * group DM, use `macro.channels.private(users)`.
   *
   * @returns The DM `Channel`.
   *
   * @write
   * @idempotent
   */
  dm(): Promise<Channel> {
    return Channel.dm(this.client, this);
  }

  /**
   * Privacy-reviewed summaries of this user's work in an inclusive UTC date
   * range, for yourself or a current teammate; at most 366 days.
   *
   * Reports are daily, Monday-start weekly, monthly and a running summary.
   * An empty list means nothing was summarized yet, not that no work happened.
   * Anyone outside the caller's current teams fails with 403.
   *
   * @example
   * const me = await macro.users.me();
   * const reports = await me.activity({ start: '2026-10-01', end: '2026-10-31' });
   * const weeks = reports.filter((report) => report.granularity === 'week');
   *
   * @readonly
   */
  async activity(range: {
    start: Date | string;
    end: Date | string;
  }): Promise<ActivityReport[]> {
    const { reports } = unwrap(
      await this.client.cognition.getUserActivity({
        query: {
          user: this.id,
          start: utcDate(range.start),
          end: utcDate(range.end),
        },
      }),
    );
    return reports;
  }

  /**
   * This agent account's AI spend in USD, summed per UTC day (last 30 days),
   * Monday-start week (last 26), month (last 12) or year (last 5), oldest
   * first. Only buckets with spend are listed; treat missing ones as zero.
   *
   * Readable by the agent itself and by owners and admins of a team it
   * belongs to. Anyone else, or reading a person rather than an agent account,
   * fails with a not-found error.
   *
   * @example
   * const weeks = await agentAccount.spend({ bucket: 'week' });
   * const total = weeks.buckets.reduce((sum, b) => sum + b.costUsd, 0);
   *
   * @readonly
   */
  async spend(options?: { bucket?: AgentSpendBucket }): Promise<AgentSpend> {
    return unwrap(
      await this.client.cognition.getAgentSpendHandler({
        path: { agent_id: this.id },
        query: { bucket: options?.bucket },
      }),
    );
  }

  /**
   * This agent account's routines, oldest first (at most 50), with whether
   * each is on, running, when it runs next and how its last run went. Only
   * a summary: steps, instructions and run results stay private to the agent.
   *
   * Readable by the agent itself and by owners and admins of a team it
   * belongs to. Anyone else, or reading a person rather than an agent
   * account, fails with a not-found error.
   *
   * @example
   * const { routines } = await agentAccount.routines();
   * const failing = routines.filter((r) => r.lastRun?.succeeded === false);
   *
   * @readonly
   */
  async routines(): Promise<AgentRoutineList> {
    const { routines, truncated } = unwrap(
      await this.client.scheduledAction.listAgentRoutines({
        path: { agent_id: this.id },
      }),
    );
    return {
      routines: routines.map((record: AgentRoutineRecord) => ({
        routine: Routine.byId(this.client, record.id),
        name: record.name,
        enabled: record.enabled,
        running: record.running,
        triggerKind: record.triggerKind,
        nextRunAt: record.nextRunAt ?? undefined,
        lastRun: record.lastRun ?? undefined,
      })),
      truncated,
    };
  }

  /**
   * This user as an @-mention part for a message template.
   *
   * @readonly
   */
  toMention(): MentionPart {
    return {
      tag: wrapXml('m-user-mention', { userId: this.id }),
      mention: { entity_type: 'user', entity_id: this.id },
    };
  }
}

function utcDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

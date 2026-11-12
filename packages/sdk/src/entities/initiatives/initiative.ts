import type {
  CreateInitiativeRequest,
  InitiativeActivityCursor,
  InitiativeDetail,
} from '../../../generated/storage/types.gen';
import type { RichMessage } from '../../mentions';
import { paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import {
  DiscussionComment,
  type DiscussionParent,
  type DiscussionThread,
  listDiscussionThreads,
  postDiscussionComment,
} from '../messages/discussion';
import {
  MessageThread,
  type TimelineOptions,
  timeline,
} from '../messages/thread';
import { EntityAccess } from '../sharing/access';
import {
  type SharePermissionOptions,
  sharePermissionBody,
} from '../sharing/permissions';
import { Task } from '../tasks/task';
import { User } from '../users/user';

/** Initiative creation settings. */
export interface InitiativeOptions {
  /** Initiative name. */
  name: string;
  /** Collaborative description. */
  description?: string;
  /** Members assigned to this initiative. */
  members?: User[];
  /** Initial properties. */
  propertyValues?: CreateInitiativeRequest['propertyValues'];
  /** Whether the current team can access it. */
  shareWithTeam?: boolean;
}

/** One change in an initiative's history. */
export interface InitiativeActivityEntry {
  /** Stable record id, for deduplicating entries across reads. */
  id: string;
  /** Who mechanically acted: a user, or an agent acting for one. */
  actor: User;
  /** The user the change is attributed to, the same as `actor` unless an agent acted for them. */
  subject: User;
  /** Activity tag, e.g. `created`, `edited`, `property_changed`, `task_added`, `task_removed`. */
  action: string;
  /** The action's details; absent for actions this deployment does not know. */
  payload: unknown;
  /** When it happened, RFC 3339. */
  occurredAt: string;
}

/** A group of tasks and members working toward an outcome. */
export class Initiative extends MacroEntity<InitiativeDetail> {
  /** How entity-addressed APIs identify this entity's type. */
  readonly entityType = 'initiative';

  /** Access requests and direct user grants. */
  readonly access = new EntityAccess(this.client, 'initiative', this);

  /**
   * The initiative's URL in the Macro web app; hand it to users as the link.
   *
   * @readonly
   */
  webUrl(): string {
    return `${this.client.webAppUrl}/app/initiative/${this.id}`;
  }

  /** Identity, loaded detail and {@link webUrl}, so serialized handles carry their link. */
  override toJSON() {
    return { ...super.toJSON(), url: this.webUrl() };
  }

  /** Construct a lazy initiative handle. */
  static byId(client: MacroClient, id: string): Initiative {
    return new Initiative(client, id);
  }

  /** Seed from an initiative detail response. */
  static from(client: MacroClient, record: InitiativeDetail): Initiative {
    return new Initiative(client, record.id, record);
  }

  protected async fetch(): Promise<InitiativeDetail> {
    return unwrap(
      await this.client.storage.getInitiative({
        path: { initiative_id: this.id },
      }),
    );
  }

  /** Display name. */
  readonly name = this.field('name');

  /** Owner. */
  readonly owner = this.mappedField('ownerId', (id) =>
    User.byId(this.client, id),
  );

  /** Assigned members. */
  readonly members = this.mappedField('memberIds', (ids) =>
    ids.map((id) => User.byId(this.client, id)),
  );

  /**
   * Tasks in this initiative. For their names, pass them to
   * `macro.tasks.summaries` (one request) instead of calling `name()` on each.
   */
  readonly tasks = this.mappedField('taskIds', (ids) =>
    ids.map((id) => Task.byId(this.client, id)),
  );

  /** Current user's access. */
  readonly accessLevel = this.field('userAccessLevel');

  /** Sharing configuration. */
  readonly sharePermissions = this.field('sharePermission');

  /**
   * The description as GitHub-flavored Markdown; empty while no one has opened
   * or written it.
   *
   * @readonly
   */
  async description(): Promise<string> {
    return unwrap(
      await this.client.storage.getInitiativeDescription({
        path: { initiative_id: this.id },
      }),
    ).markdown;
  }

  /** The initiative this discussion hangs off. */
  private get commentParent(): DiscussionParent {
    return { type: 'initiative', id: this.id };
  }

  /**
   * The discussion's comment threads, each with its comments, newest thread first.
   *
   * @readonly
   */
  async comments(): Promise<DiscussionThread[]> {
    return listDiscussionThreads(this.client, this.commentParent);
  }

  /**
   * Start a new thread in the discussion; reply to a thread with
   * {@link DiscussionComment.reply} on one of its comments.
   *
   * @param body - Plain text, or a rich body composed with {@link msg}.
   *
   * @write
   */
  async comment(body: string | RichMessage): Promise<DiscussionComment> {
    return postDiscussionComment(this.client, this.commentParent, body);
  }

  /**
   * A handle to one of the discussion's comments by id.
   *
   * @readonly
   */
  commentById(id: string): DiscussionComment {
    return DiscussionComment.byId(this.client, this.commentParent, id);
  }

  /**
   * A discussion thread, to resolve or delete it.
   *
   * @readonly
   */
  messageThreadById(id: string): MessageThread {
    return MessageThread.byId(
      this.client,
      { type: 'initiative', entity: this },
      id,
    );
  }

  /**
   * A mixed page of discussion comments and activity.
   *
   * @readonly
   */
  timelinePage(selection?: TimelineOptions<DiscussionComment>) {
    return timeline(
      this.client,
      { type: 'initiative', entity: this },
      (record) =>
        DiscussionComment.from(this.client, this.commentParent, record),
      selection,
    );
  }

  /**
   * Update the name, membership or sharing configuration.
   *
   * @write
   * @idempotent
   */
  async update(options: {
    name?: string;
    members?: User[];
    sharePermission?: SharePermissionOptions;
  }): Promise<void> {
    await this.mutate((c) =>
      c.storage.updateInitiative({
        path: { initiative_id: this.id },
        body: {
          name: options.name,
          memberIds: options.members?.map((u) => u.id),
          sharePermission: options.sharePermission
            ? sharePermissionBody(options.sharePermission)
            : undefined,
        },
      }),
    );
  }

  /**
   * This initiative's history, newest first, auto-paginated: creation, edits,
   * property changes and tasks added or removed, optionally within
   * `[after, before)`.
   *
   * Task entries appear only for tasks you can currently view.
   *
   * @example
   * const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
   * for await (const entry of initiative.activity({ after: since })) {
   *   console.log(entry.occurredAt, entry.action, await entry.actor.name());
   * }
   *
   * @readonly
   */
  activity(
    window: { after?: Date | string; before?: Date | string } = {},
  ): AsyncGenerator<InitiativeActivityEntry> {
    const after = timestamp(window.after);
    const before = timestamp(window.before);
    return paginate<InitiativeActivityEntry, InitiativeActivityCursor>(
      async (cursor) => {
        const page = unwrap(
          await this.client.storage.getInitiativeActivity({
            path: { initiative_id: this.id },
            query: {
              after,
              before,
              cursorOccurredAt: cursor?.occurredAt,
              cursorId: cursor?.id,
            },
          }),
        );
        return {
          items: page.records.map((record) => ({
            id: record.id,
            actor: User.byId(this.client, record.actorId),
            subject: User.byId(this.client, record.subjectId),
            action: record.action,
            payload: record.actionPayload ?? undefined,
            occurredAt: record.occurredAt,
          })),
          nextCursor: page.nextCursor,
        };
      },
    );
  }

  /**
   * Delete this initiative.
   *
   * @destructive
   * @idempotent
   */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.storage.deleteInitiative({ path: { initiative_id: this.id } }),
    );
  }
}

function timestamp(value: Date | string | undefined): string | undefined {
  return value instanceof Date ? value.toISOString() : value;
}

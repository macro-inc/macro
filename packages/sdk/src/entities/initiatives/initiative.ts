import type {
  CreateInitiativeRequest,
  InitiativeDetail,
} from '../../../generated/storage/types.gen';
import type { RichMessage } from '../../mentions';
import { unwrap } from '../../utils';
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

/** A group of tasks and members working toward an outcome. */
export class Initiative extends MacroEntity<InitiativeDetail> {
  /** How entity-addressed APIs identify this entity's type. */
  readonly entityType = 'initiative';

  /** Access requests and direct user grants. */
  readonly access = new EntityAccess(this.client, 'initiative', this);

  /** The initiative's URL in the Macro web app; hand it to users as the link. */
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

  /** The discussion's comment threads, each with its comments, newest thread first. */
  async comments(): Promise<DiscussionThread[]> {
    return listDiscussionThreads(this.client, this.commentParent);
  }

  /**
   * Start a new thread in the discussion; reply to a thread with
   * {@link DiscussionComment.reply} on one of its comments.
   *
   * @param body - Plain text, or a rich body composed with {@link msg}.
   */
  async comment(body: string | RichMessage): Promise<DiscussionComment> {
    return postDiscussionComment(this.client, this.commentParent, body);
  }

  /** A handle to one of the discussion's comments by id. */
  commentById(id: string): DiscussionComment {
    return DiscussionComment.byId(this.client, this.commentParent, id);
  }

  /** A discussion thread, to resolve or delete it. */
  messageThreadById(id: string): MessageThread {
    return MessageThread.byId(
      this.client,
      { type: 'initiative', entity: this },
      id,
    );
  }

  /** A mixed page of discussion comments and activity. */
  timelinePage(selection?: TimelineOptions<DiscussionComment>) {
    return timeline(
      this.client,
      { type: 'initiative', entity: this },
      (record) =>
        DiscussionComment.from(this.client, this.commentParent, record),
      selection,
    );
  }

  /** Update the name, membership or sharing configuration. */
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

  /** Delete this initiative. */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.storage.deleteInitiative({ path: { initiative_id: this.id } }),
    );
  }
}

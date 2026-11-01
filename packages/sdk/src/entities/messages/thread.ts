import type {
  MessageListItem,
  MessageTimelineQuery,
  ThreadPatch,
  ThreadState,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { CallRecord } from '../calls/call-record';
import type { CallMessage } from '../calls/message';
import type { Channel } from '../channels/channel';
import type { Message } from '../channels/message';
import type { CrmComment } from '../crm/comment';
import type { Company } from '../crm/company';
import type { Contact } from '../crm/contact';
import type { Comment } from '../documents/comment';
import type { Document } from '../documents/document';
import { MacroEntity } from '../entity';
import { User } from '../users/user';

/** A message handle accepted by a mixed timeline selector. */
export type TimelineMessage = Message | Comment | CrmComment | CallMessage;

/** Timeline selection with typed message references and camel case options. */
export interface TimelineOptions<
  TMessage extends TimelineMessage = TimelineMessage,
> {
  /** Opaque continuation cursor from a previous page. */
  cursor?: MessageTimelineQuery['cursor'];
  /** Fetch around this message. */
  around?: TMessage;
  /** Restrict selection to these messages. */
  messages?: TMessage[];
  /** Inclusive activity lower bound. */
  activityAfter?: string;
  /** Exclusive activity upper bound. */
  activityBefore?: string;
  /** Select anchored threads. */
  anchored?: boolean;
  /** Page direction. */
  direction?: MessageTimelineQuery['direction'];
  /** Include deleted threads. */
  includeDeletedThreads?: boolean;
  /** Page size. */
  limit?: number;
}

/** The typed parent of a shared message thread. */
export type MessageParent =
  | { type: 'channel'; entity: Channel }
  | { type: 'document'; entity: Document }
  | { type: 'crm_company'; entity: Company }
  | { type: 'crm_contact'; entity: Contact }
  | { type: 'call'; entity: CallRecord };

/** A shared message thread with resolution and deletion operations. */
export class MessageThread extends MacroEntity<ThreadState> {
  /** Serialize identity with its owning resource. */
  override toJSON() {
    return {
      ...super.toJSON(),
      parentType: this.parent.type,
      parentId: this.parent.entity.id,
    };
  }

  private constructor(
    client: MacroClient,
    /** The entity containing this thread. */
    readonly parent: MessageParent,
    id: string,
  ) {
    super(client, id);
  }

  /** Construct a scoped thread handle. */
  static byId(
    client: MacroClient,
    parent: MessageParent,
    id: string,
  ): MessageThread {
    return new MessageThread(client, parent, id);
  }

  private get path() {
    return {
      parent_type: this.parent.type,
      parent_id: this.parent.entity.id,
      id: this.id,
    };
  }

  protected async fetch(): Promise<ThreadState> {
    return unwrap(
      await this.client.storage.entityMessageGetThread({ path: this.path }),
    ).state;
  }

  /** Whether the thread is resolved. */
  readonly resolved = this.field('resolved');

  /** Resolve the thread or detach its annotation anchor. */
  async update(options: {
    resolved?: boolean;
    detachAnchor?: boolean;
    nonce?: string;
  }): Promise<void> {
    const body: ThreadPatch = {
      resolved: options.resolved,
      detach_anchor: options.detachAnchor,
      nonce: options.nonce,
    };
    await this.mutate((c) =>
      c.storage.entityMessagePatchThread({ path: this.path, body }),
    );
  }

  /** Delete the entire thread, including replies. */
  async delete(nonce?: string): Promise<void> {
    await this.mutate((c) =>
      c.storage.entityMessageDeleteThread({
        path: this.path,
        query: { nonce },
      }),
    );
  }
}

/** A bounded mixed message/activity page with typed message handles. */
export async function timeline<TMessage extends TimelineMessage>(
  client: MacroClient,
  parent: MessageParent,
  map: (record: MessageListItem) => TMessage,
  selection?: TimelineOptions<TMessage>,
) {
  for (const message of [
    ...(selection?.messages ?? []),
    ...(selection?.around ? [selection.around] : []),
  ]) {
    const scope =
      'channelId' in message
        ? { type: 'channel', id: message.channelId }
        : 'documentId' in message
          ? { type: 'document', id: message.documentId }
          : 'callId' in message
            ? { type: 'call', id: message.callId }
            : message.parent;
    if (scope.type !== parent.type || scope.id !== parent.entity.id)
      throw new Error('Timeline message belongs to another resource');
  }
  const page = unwrap(
    await client.storage.messageTimelineEntries({
      path: { parent_type: parent.type, parent_id: parent.entity.id },
      query: {
        selection: selection
          ? JSON.stringify({
              cursor: selection.cursor,
              around: selection.around?.id,
              ids: selection.messages?.map((m) => m.id),
              activity_after: selection.activityAfter,
              activity_before: selection.activityBefore,
              anchored: selection.anchored,
              direction: selection.direction,
              include_deleted_threads: selection.includeDeletedThreads,
              limit: selection.limit,
            } satisfies MessageTimelineQuery)
          : undefined,
      },
    }),
  );
  return {
    entries: page.entries.map((entry) => {
      if (entry.type === 'activity')
        return {
          type: 'activity' as const,
          activity: {
            ...entry.activity,
            actor: User.byId(client, entry.activity.actor_id),
          },
        };
      const message = map(entry.message);
      return { type: 'message' as const, message };
    }),
    nextCursor: page.next_cursor ?? undefined,
    previousCursor: page.previous_cursor ?? undefined,
  };
}

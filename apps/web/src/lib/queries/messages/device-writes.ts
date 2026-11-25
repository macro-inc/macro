import type { useAnalytics } from '@app/lib/analytics/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { markMessageSent } from '@core/util/message-send-motion';
import type { CacheHost } from '@graphql-cache/index';
import { Telemetry, type TraceContext } from '@macro-inc/observability';
import {
  messageReferencesCrmRecord,
  refreshCrmAssociatedSoupQueries,
} from '@queries/soup/crm-association';
import {
  bumpSoupEntityTouchedAt,
  invalidateSoupEntity,
  optimisticUpdateSoupItemUpdatedAt,
  refetchSoupEntity,
} from '@queries/soup/normalized-cache';
import type { Message } from '@service-storage/messages';
import { channelWrites } from './local/channel-sync';
import type {
  ChannelDelete,
  ChannelEdit,
  ChannelReaction,
  ChannelSend,
} from './local/channel-writes';

/** A message write, whichever path makes it. */
export interface MessageWrite<TVariables, TResult> {
  /** Makes the write, whose failure only its toast reports. */
  mutate(variables: TVariables): void;
  mutateAsync(variables: TVariables): Promise<TResult>;
}

async function reported(write: Promise<unknown>): Promise<void> {
  try {
    await write;
  } catch {
    // Its toast says so.
  }
}

/**
 * Makes each write through the device's queue when `device` takes it, and as
 * the REST mutation otherwise. The two share nothing: the queue keeps its own
 * optimistic state, and a TanStack mutation never sees a write it makes.
 */
export function deviceOrRest<TVariables, TDevice, TRest>(
  device: (variables: TVariables) => Promise<TDevice> | undefined,
  rest: {
    mutate(variables: TVariables): void;
    mutateAsync(variables: TVariables): Promise<TRest>;
  }
): MessageWrite<TVariables, TDevice | TRest> {
  return {
    mutate(variables) {
      const write = device(variables);
      if (write) fireAndForget(reported(write), 'messages');
      else rest.mutate(variables);
    },
    mutateAsync: (variables) =>
      device(variables) ?? rest.mutateAsync(variables),
  };
}

/** Awaits a queued write, saying so when it fails. */
async function orToast<T>(write: Promise<T>, failure: string): Promise<T> {
  try {
    return await write;
  } catch (error) {
    console.error(failure, error);
    toast.failure(failure);
    throw error;
  }
}

/** Work beside a write, whose failure says nothing about the write. */
function beside<T>(work: () => T): T | undefined {
  try {
    return work();
  } catch (error) {
    Telemetry.error(error, { surface: 'messages' });
    return undefined;
  }
}

/**
 * Sends a channel message through the device's queue, which shows it from the
 * moment it is sent and keeps it across a lost connection.
 */
export async function sendFromDevice(
  host: CacheHost,
  send: ChannelSend,
  options: {
    analytics: ReturnType<typeof useAnalytics>;
    parentSpan?: TraceContext;
    onOptimisticInsert?: () => void;
  }
): Promise<Message> {
  const { channelId, message } = send;
  const trace = options.parentSpan ?? Telemetry.captureContext();
  markMessageSent(`channel:${send.id}`);
  const sending = orToast(
    trace.run(() => channelWrites(host).send(send)),
    'Failed to send message'
  );
  beside(() => options.onOptimisticInsert?.());
  const updatedAt = beside(() =>
    optimisticUpdateSoupItemUpdatedAt(
      channelId,
      'channel',
      new Date().toISOString()
    )
  );
  let sent: Message;
  try {
    sent = await sending;
  } catch (error) {
    beside(() => updatedAt?.rollback());
    throw error;
  }
  const afterSend = () => {
    // Sending is a `messaged` activity server-side; stamp the touch now so the
    // Recent order moves the channel up without waiting on the activity
    // consumer, which the refetch below can outrun.
    bumpSoupEntityTouchedAt(channelId);
    const isThreadReply = !!sent.thread_id;
    // The sender does not receive the notification that normally refreshes
    // this soup entity. Refresh root messages here so the channel moves to its
    // updated position in soup lists.
    if (!isThreadReply) {
      fireAndForget(refetchSoupEntity(channelId, 'channel'), 'messages');
      invalidateSoupEntity(channelId);
    }
    // CRM record lists include messages that mention or attach the record.
    if (messageReferencesCrmRecord(message))
      fireAndForget(refreshCrmAssociatedSoupQueries(), 'messages');
    options.analytics.track('channel_message_sent', {
      contentLength: message.content?.length ?? 0,
      attachmentsLength: message.attachments?.length ?? 0,
      isThreadReply,
    });
  };
  beside(() => trace.run(afterSend));
  return sent;
}

/** Deletes a channel message through the device's queue. */
export async function deleteFromDevice(
  host: CacheHost,
  deletion: ChannelDelete
): Promise<Message | undefined> {
  const trace = Telemetry.captureContext();
  const deleted = await orToast(
    channelWrites(host).remove(deletion),
    'Failed to delete message'
  );
  trace.run(() => {
    // The deleted message may have referenced a CRM record.
    fireAndForget(refreshCrmAssociatedSoupQueries(), 'messages');
  });
  return deleted;
}

/** Edits a channel message through the device's queue. */
export async function editFromDevice(
  host: CacheHost,
  edit: ChannelEdit
): Promise<Message | undefined> {
  const trace = Telemetry.captureContext();
  const edited = await orToast(
    channelWrites(host).edit(edit),
    'Failed to update message'
  );
  trace.run(() => {
    // An edit can add or remove a CRM record reference.
    fireAndForget(refreshCrmAssociatedSoupQueries(), 'messages');
  });
  return edited;
}

/** Adds or removes a reaction through the device's queue. */
export function reactFromDevice(
  host: CacheHost,
  reaction: ChannelReaction
): Promise<Message | undefined> {
  return orToast(
    channelWrites(host).react(reaction),
    reaction.add ? 'Failed to add reaction' : 'Failed to remove reaction'
  );
}

import { useReadsHeldByAgentArrival } from '@app/features/agent-navigation/context/agent-arrivals';
import type { Entity } from '@core/types';
import { fireAndForget } from '@core/util/fireAndForget';
import { useNonPrimaryEmailLinkIdHeader } from '@queries/email/link';
import { useMarkThreadAsSeenMutation } from '@queries/email/thread';
import { debounce } from '@solid-primitives/scheduled';
import { onCleanup, onMount, Show } from 'solid-js';
import {
  ensureNotificationSourceLoaded,
  markNotificationsForEntityAsReadInBackground,
} from '../notification-helpers';
import type { NotificationSource } from '../notification-source';

const DEFAULT_DEBOUNCE_TIME = 2_000;

type DebouncedMarkerProps = {
  debouncedFn: () => void;
  debounceTime?: number;
};

const makeDebouncedMarker = (props: DebouncedMarkerProps): VoidFunction => {
  const debounceTime = props.debounceTime ?? DEFAULT_DEBOUNCE_TIME;

  const trigger = debounce(props.debouncedFn, debounceTime);

  return trigger;
};

function DebouncedMarker(props: DebouncedMarkerProps) {
  const triggerDebounce =
    props.debounceTime === 0 ? props.debouncedFn : makeDebouncedMarker(props);

  onMount(() => {
    triggerDebounce();
  });

  return '';
}

type NotificationReadMarkerProps = {
  notificationSource: NotificationSource;
  debounceTime?: number;
  entity: Entity;
};

/**
 * Mark ready content read on mount; channel callers can retain their delay.
 * In a pane an agent opened, it waits until the person touches the pane: an
 * agent showing them an item doesn't mean they read it.
 */
export function NotificationReadMarker(props: NotificationReadMarkerProps) {
  const held = useReadsHeldByAgentArrival();

  return (
    <Show when={!held()}>
      <ReadMarkerOnMount {...props} />
    </Show>
  );
}

function ReadMarkerOnMount(props: NotificationReadMarkerProps) {
  if (props.entity.type === 'email') {
    return (
      <EmailReadMarker
        notificationSource={props.notificationSource}
        debounceTime={props.debounceTime ?? 0}
        threadId={props.entity.id}
      />
    );
  }

  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const markRead = async () => {
    const entity = props.entity;
    if (props.notificationSource._notificationsQuery.transport === 'rest') {
      await ensureNotificationSourceLoaded(props.notificationSource);
    }
    if (
      disposed ||
      props.entity.id !== entity.id ||
      props.entity.type !== entity.type
    )
      return;
    await markNotificationsForEntityAsReadInBackground(
      props.notificationSource,
      entity
    );
  };
  return (
    <DebouncedMarker
      debounceTime={props.debounceTime ?? 0}
      debouncedFn={() => fireAndForget(markRead(), 'notification-read')}
    />
  );
}

export function DocumentNotificationReadMarker(props: {
  notificationSource: NotificationSource;
  debounceTime?: number;
  documentId: string;
}) {
  return (
    <NotificationReadMarker
      notificationSource={props.notificationSource}
      debounceTime={props.debounceTime ?? 0}
      entity={{
        type: 'document',
        id: props.documentId,
      }}
    />
  );
}

type ChannelDebouncedNotificationReadMarkerProps = {
  notificationSource: NotificationSource;
  debounceTime?: number;
  channelId: string;
};

export const makeDebouncedChannelNotificationReadMarker = (
  props: ChannelDebouncedNotificationReadMarkerProps
) => {
  return makeDebouncedMarker({
    debounceTime: props.debounceTime,
    debouncedFn() {
      fireAndForget(
        markNotificationsForEntityAsReadInBackground(props.notificationSource, {
          type: 'channel',
          id: props.channelId,
        }),
        'notification-read'
      );
    },
  });
};

export function ChannelDebouncedNotificationReadMarker(
  props: ChannelDebouncedNotificationReadMarkerProps
) {
  return (
    <NotificationReadMarker
      notificationSource={props.notificationSource}
      debounceTime={props.debounceTime ?? DEFAULT_DEBOUNCE_TIME}
      entity={{
        type: 'channel',
        id: props.channelId,
      }}
    />
  );
}

type EmailReadMarkerProps = {
  notificationSource: NotificationSource;
  debounceTime?: number;
  threadId: string;
  /** The inbox the thread belongs to; scopes mark-as-seen to a non-primary inbox. */
  linkId?: string;
};

/** Marks an email thread seen; waits, like the others, in a pane an agent opened. */
export function EmailReadMarker(props: EmailReadMarkerProps) {
  const held = useReadsHeldByAgentArrival();

  return (
    <Show when={!held()}>
      <EmailSeenOnMount {...props} />
    </Show>
  );
}

function EmailSeenOnMount(props: EmailReadMarkerProps) {
  const markSeenMutation = useMarkThreadAsSeenMutation();
  const toHeaderLinkId = useNonPrimaryEmailLinkIdHeader();

  return (
    <>
      <NotificationReadMarker
        notificationSource={props.notificationSource}
        debounceTime={props.debounceTime}
        entity={{ type: 'email_thread', id: props.threadId }}
      />
      <DebouncedMarker
        debounceTime={props.debounceTime ?? 0}
        debouncedFn={() =>
          markSeenMutation.mutate({
            threadId: props.threadId,
            linkId: toHeaderLinkId(props.linkId),
          })
        }
      />
    </>
  );
}

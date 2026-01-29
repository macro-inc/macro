import type { Entity } from '@core/types';
import { useMarkThreadAsSeenMutation } from '@queries/email/thread';
import { onMount } from 'solid-js';
import {
  markNotificationForEntityIdAsRead,
  markNotificationsForEntityAsRead,
} from '../notification-helpers';
import type { NotificationSource } from '../notification-source';
import { debounce } from '@solid-primitives/scheduled';

const DEFAULT_DEBOUNCE_TIME = 2_000;

type DebouncedMarkerProps = {
  debouncedFn: () => void;
  debounceTime?: number;
};

export const makeDebouncedMarker = (
  props: DebouncedMarkerProps
): VoidFunction => {
  const debounceTime = props.debounceTime ?? DEFAULT_DEBOUNCE_TIME;

  const trigger = debounce(props.debouncedFn, debounceTime);

  return trigger;
};

function DebouncedMarker(props: DebouncedMarkerProps) {
  const triggerDebounce = makeDebouncedMarker(props);

  onMount(() => {
    triggerDebounce();
  });

  return '';
}

/**
 * Debounced component that marks a notification as read
 * @param props
 * @returns
 */
export function DebouncedNotificationReadMarker(props: {
  notificationSource: NotificationSource;
  debounceTime?: number;
  entity: Entity | Omit<Entity, 'type'>;
}) {
  if ('type' in props.entity && props.entity.type === 'email') {
    return (
      <EmailDebouncedReadMarker
        notificationSource={props.notificationSource}
        debounceTime={props.debounceTime}
        threadId={props.entity.id}
      />
    );
  }

  return (
    <DebouncedMarker
      debounceTime={props.debounceTime}
      debouncedFn={() => {
        if ('type' in props.entity) {
          markNotificationsForEntityAsRead(
            props.notificationSource,
            props.entity
          );
        } else {
          markNotificationForEntityIdAsRead(
            props.notificationSource,
            props.entity.id
          );
        }
      }}
    />
  );
}

export function DocumentDebouncedNotificationReadMarker(props: {
  notificationSource: NotificationSource;
  debounceTime?: number;
  documentId: string;
}) {
  return (
    <DebouncedNotificationReadMarker
      notificationSource={props.notificationSource}
      debounceTime={props.debounceTime}
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
      markNotificationsForEntityAsRead(props.notificationSource, {
        type: 'channel',
        id: props.channelId,
      });
    },
  });
};

export function ChannelDebouncedNotificationReadMarker(
  props: ChannelDebouncedNotificationReadMarkerProps
) {
  return (
    <DebouncedNotificationReadMarker
      notificationSource={props.notificationSource}
      debounceTime={props.debounceTime}
      entity={{
        type: 'channel',
        id: props.channelId,
      }}
    />
  );
}

export function EmailDebouncedReadMarker(props: {
  notificationSource: NotificationSource;
  debounceTime?: number;
  threadId: string;
}) {
  const markSeenMutation = useMarkThreadAsSeenMutation();

  return (
    <DebouncedMarker
      debounceTime={props.debounceTime}
      debouncedFn={() => {
        markSeenMutation.mutate({ threadId: props.threadId });
      }}
    />
  );
}

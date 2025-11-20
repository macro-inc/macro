import type { Entity } from '@core/types';
import {
  markNotificationForEntityIdAsRead,
  markNotificationsForEntityAsRead,
} from '@notifications/notification-helpers';
import type { NotificationSource } from '@notifications/notification-source';
import { emailClient } from '@service-email/client';
import { onCleanup, onMount } from 'solid-js';

const DEFAULT_DEBOUNCE_TIME = 2_000;

function DebouncedMarker(props: {
  debouncedFn: () => void;
  debounceTime?: number;
}) {
  const debounceTime = props.debounceTime ?? DEFAULT_DEBOUNCE_TIME;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    timeout = setTimeout(() => {
      props.debouncedFn();
    }, debounceTime);
  });

  onCleanup(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
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

export function ChannelDebouncedNotificationReadMarker(props: {
  notificationSource: NotificationSource;
  debounceTime?: number;
  channelId: string;
}) {
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
  return (
    <DebouncedMarker
      debounceTime={props.debounceTime}
      debouncedFn={() => {
        emailClient.markThreadAsSeen({
          thread_id: props.threadId,
        });
      }}
    />
  );
}

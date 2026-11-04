import { isMobile } from '@core/mobile/isMobile';
import type { EntityData } from '@entity';
import {
  getGithubSenderAvatarUrl,
  isGithubNotificationType,
} from '@entity/extractors-notification/notification-description-helpers';
import { NotificationSenderIcon } from '@entity/extractors-notification/notification-sender-icon';
import {
  getNotificationAgentSender,
  getNotificationSenderFallbackName,
} from '@notifications/notification-sender';
import type { UnifiedNotification } from '@notifications/types';
import { Avatar, cn, Tooltip } from '@ui';
import { type JSX, Match, Show, Switch } from 'solid-js';
import type { InboxCardKind } from '../core/inbox-row';
import {
  InboxKindIcon,
  inboxEntityColor,
  inboxKindLabel,
} from './inbox-kind-icon';

/** Whether Macro knows a picture for who sent a notification. */
const hasKnownSender = (notification: UnifiedNotification) =>
  Boolean(
    notification.sender_id ||
      getNotificationAgentSender(notification) ||
      (isGithubNotificationType(notification.notification_metadata.tag) &&
        getGithubSenderAvatarUrl(notification))
  );

/**
 * Who a notification is from: their avatar, an initial for a sender Macro only
 * knows by name, such as an email's, or the kind of notification for one that
 * comes from no one, such as a reminder. With `badged`, a person's avatar also
 * says what kind of notification it is on its corner, in the color of the entity
 * it is on. A phone shows it larger, and `compact` smaller, for inside a stack.
 */
export function InboxSenderAvatar(props: {
  notification: UnifiedNotification | undefined;
  kind: InboxCardKind;
  /** What the notification is on, which colors its kind. */
  entity: EntityData;
  badged?: boolean;
  compact?: boolean;
}) {
  const known = () =>
    props.notification && hasKnownSender(props.notification)
      ? props.notification
      : undefined;
  const initial = () =>
    props.notification &&
    getNotificationSenderFallbackName(props.notification)
      ?.trim()
      .charAt(0)
      .toUpperCase();
  const size = () => {
    if (props.compact) return isMobile() ? 'md' : 'sm';
    return isMobile() ? 'lg' : 'md';
  };
  const frame = () =>
    props.compact ? 'size-4 mobile:size-6' : 'size-6 mobile:size-10';

  const Person = (person: { children: JSX.Element }) => (
    <span class={cn('relative block', frame())}>
      {person.children}
      <Show when={props.badged}>
        <Tooltip
          as="span"
          label={inboxKindLabel(props.kind)}
          class="absolute -right-1.5 -bottom-1.5 mobile:-right-[7px] mobile:-bottom-[7px]"
        >
          <span
            role="img"
            aria-label={inboxKindLabel(props.kind)}
            data-kind-badge={props.kind}
            // Cuts the badge out of the avatar, in the color of the card behind it.
            class={cn(
              'flex size-[18px] items-center justify-center rounded-full bg-control-raised ring-2 ring-(--inbox-card-surface) mobile:size-6',
              inboxEntityColor(props.entity)
            )}
          >
            <InboxKindIcon
              kind={props.kind}
              class="size-[11px] mobile:size-3.5"
            />
          </span>
        </Tooltip>
      </Show>
    </span>
  );

  return (
    <Switch
      fallback={
        <span
          class={cn(
            'flex items-center justify-center rounded-full border border-edge-button',
            frame(),
            inboxEntityColor(props.entity)
          )}
        >
          <InboxKindIcon
            kind={props.kind}
            class={
              props.compact
                ? 'size-2.5 mobile:size-3.5'
                : 'size-3.5 mobile:size-5'
            }
          />
        </span>
      }
    >
      <Match when={known()}>
        {(notification) => (
          <Person>
            <NotificationSenderIcon
              notification={notification()}
              size={size()}
            />
          </Person>
        )}
      </Match>
      <Match when={initial()}>
        {(letter) => (
          <Person>
            <Avatar size={size()}>
              <Avatar.Fallback class="font-semibold">
                {letter()}
              </Avatar.Fallback>
            </Avatar>
          </Person>
        )}
      </Match>
    </Switch>
  );
}

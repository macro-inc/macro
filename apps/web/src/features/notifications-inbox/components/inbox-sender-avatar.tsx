import { isMobile } from '@core/mobile/isMobile';
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
import { Avatar, Tooltip } from '@ui';
import { type JSX, Match, Show, Switch } from 'solid-js';
import type { InboxCardKind } from '../core/inbox-row';
import { InboxKindIcon, inboxKindLabel } from './inbox-kind-icon';

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
 * says what kind of notification it is on its corner. A phone shows it larger.
 */
export function InboxSenderAvatar(props: {
  notification: UnifiedNotification | undefined;
  kind: InboxCardKind;
  badged?: boolean;
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
  const size = () => (isMobile() ? 'lg' : 'md');

  const Person = (person: { children: JSX.Element }) => (
    <span class="relative block size-6 mobile:size-10">
      {person.children}
      <Show when={props.badged}>
        <Tooltip
          as="span"
          label={inboxKindLabel(props.kind)}
          class="absolute -right-1.5 -bottom-1.5"
        >
          <span
            role="img"
            aria-label={inboxKindLabel(props.kind)}
            data-kind-badge={props.kind}
            // Cuts the badge out of the avatar, in the color of the card behind it.
            class="flex size-3.5 items-center justify-center rounded-full bg-control-raised text-ink-muted ring-2 ring-(--inbox-card-surface) mobile:size-5"
          >
            <InboxKindIcon kind={props.kind} class="size-[9px] mobile:size-3" />
          </span>
        </Tooltip>
      </Show>
    </span>
  );

  return (
    <Switch
      fallback={
        <span class="flex size-6 items-center justify-center rounded-full border border-edge-button text-ink-extra-muted mobile:size-10">
          <InboxKindIcon kind={props.kind} class="size-3.5 mobile:size-5" />
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

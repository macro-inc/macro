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
import { Avatar } from '@ui';
import { Match, Switch } from 'solid-js';
import type { InboxRow } from '../core/inbox-row';
import { InboxRowIcon } from './inbox-row-icon';

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
 * comes from no one, such as a reminder. A phone shows it larger.
 */
export function InboxSenderAvatar(props: {
  notification: UnifiedNotification | undefined;
  type: InboxRow<unknown>['type'];
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

  return (
    <Switch
      fallback={
        <span class="flex size-6 items-center justify-center rounded-full border border-edge-button text-ink-extra-muted mobile:size-10">
          <InboxRowIcon type={props.type} class="size-3.5 mobile:size-5" />
        </span>
      }
    >
      <Match when={known()}>
        {(notification) => (
          <NotificationSenderIcon notification={notification()} size={size()} />
        )}
      </Match>
      <Match when={initial()}>
        {(letter) => (
          <Avatar size={size()}>
            <Avatar.Fallback class="font-semibold">{letter()}</Avatar.Fallback>
          </Avatar>
        )}
      </Match>
    </Switch>
  );
}

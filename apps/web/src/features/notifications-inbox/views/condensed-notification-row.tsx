import { HomeListEntity } from '@app/features/home/components/HomeListEntity';
import { t } from '@app/lib/i18n';
import { loadedChannel, useChannelDirectory } from '@core/context/channels';
import type { EntityData, WithNotification } from '@entity';
import { getChannelThreadName } from '@entity/utils/channel-thread-name';
import CheckIcon from '@icon/system/regular/check.svg';
import { Button } from '@ui';
import { createMemo } from 'solid-js';
import type { NotificationInboxRow } from '../context/notifications-inbox-context';
import { rowEntity } from '../primitives/row-entity';

/**
 * One inbox row on one line, drawn as Home draws a notification's row: what
 * it is about and, for a reply or a comment, who did it. Its time shows on
 * hover, beside Mark done, which takes the unread dot's place. A stack stays
 * one row; opening it shows the newest notification.
 */
export function CondensedNotificationRow(props: {
  row: NotificationInboxRow;
  highlighted: boolean;
  onHover: () => void;
  onClick: (event: MouseEvent) => void;
  onDone: () => void;
}) {
  const directory = useChannelDirectory();
  const entity = createMemo(
    (): WithNotification<EntityData> => ({
      ...rowEntity(props.row),
      notifications: () => props.row.content.notifications,
    })
  );
  const channelName = () => {
    const current = entity();
    if (current.type !== 'channel_thread') return undefined;
    const channel = loadedChannel(directory.lookup(current.channelId));
    return getChannelThreadName(
      current,
      channel ? { [channel.id]: channel } : {}
    );
  };
  return (
    <div
      id={props.row.id}
      role="row"
      aria-selected={props.highlighted}
      data-notification-row=""
      onMouseEnter={() => props.onHover()}
    >
      <HomeListEntity
        entity={entity()}
        occurrenceKey={props.row.id}
        channelName={channelName()}
        // A row about a thread is filed under its channel; Home names it
        // after the thread.
        thread={props.row.threadId !== undefined}
        timestamp={new Date(props.row.latestAt)}
        unread={props.row.unseen}
        highlighted={props.highlighted}
        hideCheckbox
        onClick={(event) => props.onClick(event)}
        hoverAction={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={t('notificationsInbox.markDone')}
            tooltip={t('notificationsInbox.markDone')}
            // The row opens on mousedown; this press is the button's alone.
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              props.onDone();
            }}
          >
            <CheckIcon class="size-3.5" />
          </Button>
        }
      />
    </div>
  );
}

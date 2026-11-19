import { t } from '@app/lib/i18n';
import { Button, Tabs } from '@ui';
import { Show } from 'solid-js';
import type {
  ChannelStack,
  NotificationListView,
} from '../core/channel-stacks';
import type { SenderName } from './stack-label';
import { StackList } from './stack-list';

/**
 * The list's content wherever it is shown, docked in the gutter or in a
 * popover: a switch between not-done and unread stacks, their rows, and a way
 * to clear them all.
 */
export function NotificationListPanel(props: {
  view: NotificationListView;
  onViewChange: (view: NotificationListView) => void;
  stacks: readonly ChannelStack[];
  senderName: SenderName;
  onOpen: (stack: ChannelStack) => void;
  onAction: (stack: ChannelStack) => void;
  onActionAll: () => void;
}) {
  const isNotDone = () => props.view === 'not_done';

  return (
    <div class="flex min-h-0 flex-col gap-2">
      <Tabs
        aria-label={t('channelNotificationStacks.viewChoice')}
        size="sm"
        fullWidth
        options={[
          {
            value: 'not_done',
            label: t('channelNotificationStacks.viewNotDone'),
          },
          { value: 'unread', label: t('channelNotificationStacks.viewUnread') },
        ]}
        value={props.view}
        onChange={props.onViewChange}
      />
      <div class="min-h-0 overflow-y-auto overscroll-contain">
        <StackList
          stacks={props.stacks}
          senderName={props.senderName}
          action={isNotDone() ? 'done' : 'read'}
          empty={
            isNotDone()
              ? t('channelNotificationStacks.emptyNotDone')
              : t('channelNotificationStacks.emptyUnread')
          }
          onOpen={props.onOpen}
          onAction={props.onAction}
        />
      </div>
      <Show when={props.stacks.length > 1}>
        <Button
          variant="ghost"
          size="xs"
          class="self-start"
          onClick={() => props.onActionAll()}
        >
          {isNotDone()
            ? t('channelNotificationStacks.markAllDone')
            : t('channelNotificationStacks.markAllRead')}
        </Button>
      </Show>
    </div>
  );
}

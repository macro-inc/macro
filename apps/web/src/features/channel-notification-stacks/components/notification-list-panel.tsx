import { t } from '@app/lib/i18n';
import { Button, Tabs } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import type {
  ChannelStack,
  NotificationListView,
  StackListStatus,
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
  status: StackListStatus;
  onRetry: () => void;
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
      <Switch>
        <Match when={props.status === 'loading' || props.status === 'retrying'}>
          <p class="px-2 py-1.5 text-[13px] leading-[18px] text-ink-extra-muted">
            {t('common.loading')}
          </p>
        </Match>
        <Match when={props.status === 'failed'}>
          <div class="flex flex-col items-start gap-1 px-2 py-1.5">
            <p class="text-[13px] leading-[18px] text-ink-extra-muted">
              {t('channelNotificationStacks.loadFailed')}
            </p>
            <Button variant="ghost" size="xs" onClick={() => props.onRetry()}>
              {t('common.retry')}
            </Button>
          </div>
        </Match>
        <Match when={props.status === 'ready'}>
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
        </Match>
      </Switch>
      <Show when={props.status === 'ready' && props.stacks.length > 1}>
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

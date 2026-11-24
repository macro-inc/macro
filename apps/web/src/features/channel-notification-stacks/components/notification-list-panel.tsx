import { t } from '@app/lib/i18n';
import { Button } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import type { ChannelStack, StackListStatus } from '../core/channel-stacks';
import type { SenderName } from './stack-label';
import { StackList } from './stack-list';

/**
 * The list's content wherever it is shown, docked in the gutter or in a
 * popover: the listed stacks under an Unread heading, and a way to mark them
 * all done.
 */
export function NotificationListPanel(props: {
  stacks: readonly ChannelStack[];
  status: StackListStatus;
  onRetry: () => void;
  senderName: SenderName;
  onOpen: (stack: ChannelStack) => void;
  onMarkDone: (stack: ChannelStack) => void;
  onMarkAllDone: () => void;
}) {
  return (
    <div class="flex min-h-0 flex-col gap-1">
      <h2 class="px-2 pt-0.5 text-xs font-medium text-ink-muted">
        {t('channelNotificationStacks.title')}
      </h2>
      {/* Listed stacks stay listed while a later read fails. */}
      <Switch>
        <Match when={props.stacks.length > 0}>
          <div class="min-h-0 overflow-y-auto overscroll-contain">
            <StackList
              stacks={props.stacks}
              senderName={props.senderName}
              onOpen={props.onOpen}
              onMarkDone={props.onMarkDone}
            />
          </div>
        </Match>
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
      </Switch>
      {/* A refresh that fails under listed stacks says so, to retry. */}
      <Show when={props.stacks.length > 0 && props.status === 'failed'}>
        <div class="flex items-center gap-1 px-2">
          <p class="text-xs text-ink-extra-muted">
            {t('channelNotificationStacks.loadFailed')}
          </p>
          <Button variant="ghost" size="xs" onClick={() => props.onRetry()}>
            {t('common.retry')}
          </Button>
        </div>
      </Show>
      <Show when={props.stacks.length > 1}>
        <Button
          variant="ghost"
          size="xs"
          class="mt-1 self-start"
          onClick={() => props.onMarkAllDone()}
        >
          {t('channelNotificationStacks.markAllDone')}
        </Button>
      </Show>
    </div>
  );
}

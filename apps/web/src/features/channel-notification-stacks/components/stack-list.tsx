import { t } from '@app/lib/i18n';
import BellIcon from '@icon/system/regular/bell.svg';
import { Button, cn } from '@ui';
import { For, Show } from 'solid-js';
import type { ChannelStack } from '../core/channel-stacks';
import { StackKindIcon } from './stack-kind-icon';
import { type SenderName, stackLabel } from './stack-label';

/** What a row's trailing bell does: mark the stack done, or read. */
export type StackListAction = 'done' | 'read';

/**
 * One row per stack: its kind and label open it in the channel, and a bell
 * that shows on hover or keyboard focus marks it done or read.
 */
export function StackList(props: {
  stacks: readonly ChannelStack[];
  senderName: SenderName;
  action: StackListAction;
  /** Shown when there are no stacks. */
  empty: string;
  onOpen: (stack: ChannelStack) => void;
  onAction: (stack: ChannelStack) => void;
}) {
  return (
    <Show
      when={props.stacks.length > 0}
      fallback={
        <p class="px-2 py-1.5 text-[13px] leading-[18px] text-ink-extra-muted">
          {props.empty}
        </p>
      }
    >
      <ul class="flex flex-col gap-px">
        <For each={props.stacks}>
          {(stack) => {
            const label = () => stackLabel(stack, props.senderName);
            const unseen = () =>
              stack.notifications.some(
                (notification) => notification.state === 'unseen'
              );

            return (
              <li class="group/stack relative flex items-center rounded-lg not-touch:hover:bg-hover">
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-start gap-2 rounded-lg py-1.5 pr-8 pl-2 text-left text-[13px] leading-[18px] text-ink outline-hidden focus-visible:ring-2 focus-visible:ring-edge-focus"
                  onClick={() => props.onOpen(stack)}
                >
                  <span class="flex h-[18px] shrink-0 items-center">
                    <StackKindIcon
                      stack={stack}
                      class="size-3.5 text-ink-extra-muted"
                    />
                  </span>
                  <span class={cn('min-w-0 flex-1', unseen() && 'font-medium')}>
                    {label()}
                  </span>
                </button>
                <span class="absolute top-1 right-1 opacity-0 group-hover/stack:opacity-100 group-focus-within/stack:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={
                      props.action === 'done'
                        ? t('channelNotificationStacks.markStackDone', {
                            label: label(),
                          })
                        : t('channelNotificationStacks.markStackRead', {
                            label: label(),
                          })
                    }
                    tooltip={
                      props.action === 'done'
                        ? t('channelNotificationStacks.markDone')
                        : t('channelNotificationStacks.markRead')
                    }
                    onClick={() => props.onAction(stack)}
                  >
                    <BellIcon class="size-3.5" />
                  </Button>
                </span>
              </li>
            );
          }}
        </For>
      </ul>
    </Show>
  );
}

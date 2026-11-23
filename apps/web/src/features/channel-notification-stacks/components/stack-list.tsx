import { t } from '@app/lib/i18n';
import { UnreadIndicator } from '@entity/components/UnreadIndicator';
import CheckIcon from '@icon/system/regular/check.svg';
import { Button, cn, Tooltip } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { type ChannelStack, stackIsUnread } from '../core/channel-stacks';
import { StackKindIcon } from './stack-kind-icon';
import { type SenderName, stackLabel } from './stack-label';

/** What a row's trailing check does: mark the stack done, or read. */
export type StackListAction = 'done' | 'read';

/**
 * One row per stack: its kind and label open it in the channel, and a check
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
            const unseen = () => stackIsUnread(stack);
            // The tooltip repeats the label only when the clamp hid some of
            // it; measured as the pointer or focus arrives.
            let labelElement!: HTMLSpanElement;
            const [clamped, setClamped] = createSignal(false);
            const measureClamp = () =>
              setClamped(labelElement.scrollHeight > labelElement.clientHeight);

            return (
              <li
                data-unread={unseen() ? '' : undefined}
                class="group/stack relative flex items-center rounded-lg not-touch:hover:bg-hover"
              >
                <Tooltip.Root disabled={!clamped()}>
                  <Tooltip.Trigger
                    as="button"
                    type="button"
                    class="flex min-w-0 flex-1 items-start gap-2 rounded-lg py-1.5 pr-8 pl-2 text-left text-[13px] leading-[18px] text-ink outline-hidden focus-visible:ring-2 focus-visible:ring-edge-focus"
                    onPointerEnter={measureClamp}
                    onFocus={measureClamp}
                    onClick={() => props.onOpen(stack)}
                  >
                    {/* The notification inbox's leading unread dot; its slot
                        stays reserved so read rows line up. */}
                    <span class="flex h-[18px] shrink-0 items-center gap-1.5">
                      <UnreadIndicator active={unseen()} class="size-1.5" />
                      <StackKindIcon
                        stack={stack}
                        class="size-3.5 text-ink-extra-muted"
                      />
                    </span>
                    {/* A long name or address breaks anywhere rather than
                        running past the card, and a label past two lines
                        ends in an ellipsis, with the whole in the tooltip. */}
                    <span
                      ref={labelElement}
                      class={cn(
                        'line-clamp-2 min-w-0 flex-1 wrap-anywhere',
                        unseen() && 'font-medium'
                      )}
                    >
                      {label()}
                    </span>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content>
                      <div class="text-xs wrap-anywhere">{label()}</div>
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
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
                    <CheckIcon class="size-3.5" />
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

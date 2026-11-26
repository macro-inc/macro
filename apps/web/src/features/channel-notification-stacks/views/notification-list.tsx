import { t } from '@app/lib/i18n';
import { UnreadIndicator } from '@entity/components/UnreadIndicator';
import BellIcon from '@icon/system/regular/bell.svg';
import { Popover } from '@kobalte/core/popover';
import { Button, Card } from '@ui';
import {
  type Accessor,
  createEffect,
  createSignal,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { NotificationListPanel } from '../components/notification-list-panel';
import type { SenderName } from '../components/stack-label';
import {
  type ChannelStack,
  type StackListStatus,
  stackIsUnread,
} from '../core/channel-stacks';

/** The gutter the toggle needs: itself plus its inset from the pane's edge. */
const TOGGLE_MIN_GUTTER = 72;
/** The gutter a docked list needs to fit most labels in their two lines. */
const DOCKED_MIN_GUTTER = 240;
/** The list's inset from the pane's left edge and from the message column. */
const EDGE_INSET = 12;

/**
 * The toggle in the channel's gutter and the list of stacks it shows: docked
 * in the gutter when it has room, otherwise in a popover over the channel.
 * Hidden when the gutter cannot fit the toggle.
 */
export function NotificationList(props: {
  /** Width of the gutter left of the message column. */
  gutterWidth: Accessor<number>;
  open: Accessor<boolean>;
  onOpenChange: (open: boolean) => void;
  /** The listed stacks: unread when the channel opened, or since. */
  stacks: Accessor<readonly ChannelStack[]>;
  /** Whether the channel's unread notifications are known yet. */
  status: Accessor<StackListStatus>;
  onRetry: () => void;
  senderName: SenderName;
  onOpenStack: (stack: ChannelStack) => void;
  onMarkDone: (stacks: readonly ChannelStack[]) => void;
}) {
  const [popoverOpen, setPopoverOpen] = createSignal(false);
  // Only a channel with something listed shows the toggle, so nothing shows
  // while that is loading. A failed read keeps it, to retry.
  const shown = () =>
    props.status() === 'failed' ||
    props.status() === 'retrying' ||
    props.stacks().length > 0;
  // Whenever the popover's toggle goes (the last stack marked done, or the
  // gutter docking or hiding it), the popover closes and stays closed.
  createEffect(() => {
    if (!shown() || docked() || props.gutterWidth() < TOGGLE_MIN_GUTTER) {
      setPopoverOpen(false);
    }
  });
  const docked = () => props.gutterWidth() >= DOCKED_MIN_GUTTER;
  const dockedWidth = () => props.gutterWidth() - 2 * EDGE_INSET;

  const panel = (onOpenStack: (stack: ChannelStack) => void) => (
    <NotificationListPanel
      stacks={props.stacks()}
      status={props.status()}
      onRetry={() => props.onRetry()}
      senderName={props.senderName}
      onOpen={onOpenStack}
      onMarkDone={(stack) => props.onMarkDone([stack])}
      onMarkAllDone={() => props.onMarkDone(props.stacks())}
    />
  );

  // Any listed stack the viewer has not read yet.
  const hasUnread = () => props.stacks().some(stackIsUnread);
  const toggleContent = () => (
    <>
      <BellIcon class="size-4" />
      <Show when={props.stacks().length > 0}>
        <span class="tabular-nums">{props.stacks().length}</span>
      </Show>
      {/* The inbox's unread dot, in line after the count; the button's own
          gap spaces it like the bell and the count. */}
      <Show when={hasUnread()}>
        <span aria-hidden="true" data-unread-dot class="flex items-center">
          <UnreadIndicator active class="size-1.5" />
        </span>
      </Show>
    </>
  );

  return (
    <Show when={shown() && props.gutterWidth() >= TOGGLE_MIN_GUTTER}>
      <div
        data-channel-notification-list
        class="absolute top-3 z-2 flex max-h-[calc(100%-1.5rem)] flex-col items-start gap-2"
        style={{
          left: `${EDGE_INSET}px`,
          width: docked() ? `${dockedWidth()}px` : undefined,
        }}
      >
        <Switch>
          <Match when={docked()}>
            <Button
              variant="secondary"
              size="sm"
              aria-label={t('channelNotificationStacks.toggle')}
              aria-description={hasUnread() ? t('common.unread') : undefined}
              aria-expanded={props.open()}
              tooltip={{
                content: t('channelNotificationStacks.toggle'),
                placement: 'right',
              }}
              onClick={() => props.onOpenChange(!props.open())}
            >
              {toggleContent()}
            </Button>
            <Show when={props.open()}>
              {/* Docked, the list is a card raised off the channel. */}
              <Card
                data-docked-list
                variant="filled"
                depth={3}
                class="min-h-0 w-full p-2"
              >
                {panel(props.onOpenStack)}
              </Card>
            </Show>
          </Match>
          <Match when={!docked()}>
            <Popover
              open={popoverOpen()}
              onOpenChange={setPopoverOpen}
              placement="bottom-start"
              gutter={6}
              fitViewport
              overflowPadding={8}
            >
              <Popover.Trigger
                as={Button}
                variant="secondary"
                size="sm"
                aria-label={t('channelNotificationStacks.toggle')}
                aria-description={hasUnread() ? t('common.unread') : undefined}
                tooltip={{
                  content: t('channelNotificationStacks.toggle'),
                  // It would cover the popover it just opened.
                  disabled: popoverOpen(),
                }}
              >
                {toggleContent()}
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  class="menu-surface z-action-menu flex w-64 max-w-[calc(100vw-2rem)] flex-col p-2 outline-none"
                  style={{
                    'max-height':
                      'min(32rem, var(--kb-popper-content-available-height, calc(100dvh - 1rem)))',
                  }}
                >
                  {panel((stack) => {
                    setPopoverOpen(false);
                    props.onOpenStack(stack);
                  })}
                </Popover.Content>
              </Popover.Portal>
            </Popover>
          </Match>
        </Switch>
      </div>
    </Show>
  );
}

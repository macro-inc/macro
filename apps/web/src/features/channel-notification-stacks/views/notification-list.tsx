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
  type NotificationListView,
  type StackListStatus,
  stackIsUnread,
} from '../core/channel-stacks';

/** The gutter the toggle needs: itself plus its inset from the pane's edge. */
const TOGGLE_MIN_GUTTER = 72;
/** The gutter a docked list needs to keep its labels to two or three lines. */
const DOCKED_MIN_GUTTER = 240;
/** The list's inset from the pane's left edge. */
const EDGE_INSET = 12;
/** The lane the per-message checks keep free beside the column. */
const CHECK_LANE = 44;

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
  view: Accessor<NotificationListView>;
  onViewChange: (view: NotificationListView) => void;
  notDone: Accessor<readonly ChannelStack[]>;
  unread: Accessor<readonly ChannelStack[]>;
  /** Whether a view's stacks are known yet. */
  status: (view: NotificationListView) => StackListStatus;
  onRetry: (view: NotificationListView) => void;
  senderName: SenderName;
  onOpenStack: (stack: ChannelStack) => void;
  onMarkDone: (stacks: readonly ChannelStack[]) => void;
  onMarkRead: (stacks: readonly ChannelStack[]) => void;
}) {
  const [popoverOpen, setPopoverOpen] = createSignal(false);
  // Only a channel with something left to mark done shows the toggle, so
  // nothing shows while that is loading. A failed read keeps it, to retry.
  const shown = () =>
    props.status('not_done') === 'failed' ||
    props.status('not_done') === 'retrying' ||
    props.notDone().length > 0;
  // Whenever the popover's toggle goes (the last stack marked done, or the
  // gutter docking or hiding it), the popover closes and stays closed.
  createEffect(() => {
    if (!shown() || docked() || props.gutterWidth() < TOGGLE_MIN_GUTTER) {
      setPopoverOpen(false);
    }
  });
  const stacks = () =>
    props.view() === 'not_done' ? props.notDone() : props.unread();
  const docked = () => props.gutterWidth() >= DOCKED_MIN_GUTTER;
  const dockedWidth = () => props.gutterWidth() - EDGE_INSET - CHECK_LANE;

  const markOne = (stack: ChannelStack) =>
    props.view() === 'not_done'
      ? props.onMarkDone([stack])
      : props.onMarkRead([stack]);
  const markAll = () =>
    props.view() === 'not_done'
      ? props.onMarkDone(stacks())
      : props.onMarkRead(stacks());

  const panel = (onOpenStack: (stack: ChannelStack) => void) => (
    <NotificationListPanel
      view={props.view()}
      onViewChange={props.onViewChange}
      stacks={stacks()}
      status={props.status(props.view())}
      onRetry={() => props.onRetry(props.view())}
      senderName={props.senderName}
      onOpen={onOpenStack}
      onAction={markOne}
      onActionAll={markAll}
    />
  );

  // Any not-done stack the viewer has not seen yet.
  const hasUnread = () => props.notDone().some(stackIsUnread);
  const toggleContent = () => (
    <>
      <BellIcon class="size-4" />
      <Show when={stacks().length > 0}>
        <span class="tabular-nums">{stacks().length}</span>
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

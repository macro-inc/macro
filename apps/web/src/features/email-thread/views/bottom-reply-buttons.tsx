import type { ReplyType } from '@app/features/email-compose/core/reply-type';
import type { EmailMessage } from '@app/features/email-message/core/email-message';
import { t } from '@app/lib/i18n';
import { FloatRegionOrInline } from '@components/app/mobile/float-regions/FloatRegion';
import { MobileDockIsland } from '@components/app/mobile/MobileDockIsland';
import { inboxIconProps } from '@core/component/inboxIcon';
import { UserIcon } from '@core/component/UserIcon';
import { createLabelCollapse } from '@core/signal/create-label-collapse';
import { fireAndForget } from '@core/util/fireAndForget';
import CheckBoldIcon from '@icon/system/bold/check-bold.svg?component-solid';
import ArrowBendDoubleUpLeft from '@icon/system/regular/arrow-bend-double-up-left.svg';
import ArrowBendUpLeft from '@icon/system/regular/arrow-bend-up-left.svg';
import ArrowBendUpRight from '@icon/system/regular/arrow-bend-up-right.svg';
import ArrowDown from '@icon/system/regular/arrow-down.svg';
import ArrowUp from '@icon/system/regular/arrow-up.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import { createCallback } from '@solid-primitives/rootless';
import { cn } from '@ui';
import { type Component, createSignal, Show } from 'solid-js';
import type { EmailThreadListNavigation } from '../context/email-thread-context';
import { useEmailThreadState } from '../context/email-thread-state-context';
import { useEmailThreadViewContext } from '../context/email-thread-view-context';
import {
  offersReplyAll,
  openEmailReplyComposerForMessage,
} from '../primitives/reply-actions';

/**
 * A floating pill on the dock's own surface. The island stays opaque when the
 * action is unavailable; only its content dims, so the thread never shows
 * through.
 */
function ReplyActionButton(props: {
  icon: Component<{ class?: string }>;
  label?: string;
  ariaLabel?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <MobileDockIsland class="shrink-0">
      <button
        type="button"
        aria-label={props.ariaLabel}
        disabled={props.disabled}
        class={cn(
          // Literal px like the dock: chrome must not track the OS text size.
          'flex h-[40px] shrink-0 items-center justify-center gap-2 rounded-full text-sm font-medium disabled:opacity-50',
          props.label ? 'px-3' : 'w-[40px]'
        )}
        onClick={props.onClick}
      >
        <props.icon class={cn('shrink-0', props.label ? 'size-4' : 'size-6')} />
        <Show when={props.label}>
          <span>{props.label}</span>
        </Show>
      </button>
    </MobileDockIsland>
  );
}

export function BottomReplyButtons(props: {
  lastMessage: EmailMessage;
  navigation?: EmailThreadListNavigation;
}) {
  const ctx = useEmailThreadState();
  const viewContext = useEmailThreadViewContext();
  const currentUserEmail = viewContext.thread.viewerEmail;

  const open = (type: ReplyType) =>
    createCallback(() => {
      const messageId = props.lastMessage.db_id;
      if (!messageId) return;
      openEmailReplyComposerForMessage({
        isTouch: viewContext.thread.isTouch(),
        ctx,
        message: props.lastMessage,
        replyType: type,
        isLastMessage: true,
      });
    });

  const currentUserIconProps = () => {
    const email = currentUserEmail();
    return email ? inboxIconProps(email) : { email: '' };
  };

  const showReplyAll = () =>
    offersReplyAll(
      props.lastMessage,
      currentUserEmail(),
      viewContext.compose.accounts.inboxes()
    );

  const showForward = () => ctx.permissions().isOwner;

  // A narrow phone row drops these labels one at a time, in this order.
  const [actionRow, setActionRow] = createSignal<HTMLElement>();
  const labelCollapsed = createLabelCollapse(actionRow, () => [
    'reply',
    ...(showForward() ? ['forward'] : []),
    ...(showReplyAll() ? ['reply-all'] : []),
  ]);
  const shownLabel = (id: string, label: string) =>
    labelCollapsed(id) ? undefined : label;

  const isDone = () => ctx.isThreadDone();

  // Matches TopBar: a send-only thread is permanently done, so the toggle
  // would be a no-op in both directions.
  const showMarkDoneToggle = () => !isDone() || ctx.canMarkThreadNotDone();

  const toggleMarkDone = () => {
    if (isDone()) {
      ctx.markThreadNotDone();
    } else if (props.navigation) {
      fireAndForget(
        props.navigation.markDone(ctx.archiveThread),
        'email-thread'
      );
    } else {
      ctx.archiveThread();
    }
  };

  return (
    <Show
      when={viewContext.thread.isTouch()}
      fallback={
        <div class="flex w-full items-center pt-4">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left text-sm text-ink-placeholder hover:text-ink-muted"
            onClick={open('reply-all')}
          >
            <UserIcon
              {...currentUserIconProps()}
              size="md"
              showTooltip={false}
              suppressClick
            />
            <span class="truncate">{t('emailThread.replyPlaceholder')}</span>
          </button>
        </div>
      }
    >
      <FloatRegionOrInline region="accessory">
        <div class="w-full p-2 pb-2 pt-4 touch:px-(--mobile-chrome-gutter) touch:py-0">
          <div
            ref={setActionRow}
            class="flex flex-row flex-wrap items-center gap-2 justify-between touch:pointer-events-auto"
          >
            <div class="flex flex-row items-center gap-2">
              <ReplyActionButton
                icon={ArrowBendUpLeft}
                label={shownLabel('reply', t('emailThread.reply'))}
                ariaLabel={t('emailThread.reply')}
                onClick={open('reply')}
              />
              <Show when={showReplyAll()}>
                <ReplyActionButton
                  icon={ArrowBendDoubleUpLeft}
                  label={shownLabel('reply-all', t('emailThread.replyAll'))}
                  ariaLabel={t('emailThread.replyAll')}
                  onClick={open('reply-all')}
                />
              </Show>
              <Show when={showForward()}>
                <ReplyActionButton
                  icon={ArrowBendUpRight}
                  label={shownLabel('forward', t('emailThread.forward'))}
                  ariaLabel={t('emailThread.forward')}
                  onClick={open('forward')}
                />
              </Show>
            </div>

            <div class="ml-auto flex items-center gap-2">
              <Show when={props.navigation}>
                {(navigation) => (
                  <>
                    <ReplyActionButton
                      icon={ArrowUp}
                      ariaLabel={t('emailThread.previousEmail')}
                      disabled={!navigation().canPrevious()}
                      onClick={() => navigation().previous()}
                    />
                    <ReplyActionButton
                      icon={ArrowDown}
                      ariaLabel={t('emailThread.nextEmail')}
                      disabled={!navigation().canNext()}
                      onClick={() => navigation().next()}
                    />
                  </>
                )}
              </Show>
              <Show when={showMarkDoneToggle()}>
                <ReplyActionButton
                  icon={(iconProps) => (
                    <Show
                      when={isDone()}
                      fallback={<CheckIcon class={iconProps.class} />}
                    >
                      <CheckBoldIcon
                        class={cn(iconProps.class, 'text-accent')}
                      />
                    </Show>
                  )}
                  ariaLabel={
                    isDone()
                      ? t('emailThread.markNotDone')
                      : t('emailThread.markDone')
                  }
                  onClick={toggleMarkDone}
                />
              </Show>
            </div>
          </div>
        </div>
      </FloatRegionOrInline>
    </Show>
  );
}

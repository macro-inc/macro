import type { ReplyType } from '@app/features/email-compose/core/reply-type';
import type { EmailMessage } from '@app/features/email-message/core/email-message';
import { FloatRegionOrInline } from '@components/app/mobile/float-regions/FloatRegion';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import { fireAndForget } from '@core/util/fireAndForget';
import CheckBoldIcon from '@icon/system/bold/check-bold.svg?component-solid';
import ArrowBendDoubleUpLeft from '@icon/system/regular/arrow-bend-double-up-left.svg';
import ArrowBendUpLeft from '@icon/system/regular/arrow-bend-up-left.svg';
import ArrowBendUpRight from '@icon/system/regular/arrow-bend-up-right.svg';
import ArrowDown from '@icon/system/regular/arrow-down.svg';
import ArrowRight from '@icon/system/regular/arrow-right.svg';
import ArrowUp from '@icon/system/regular/arrow-up.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import { createCallback } from '@solid-primitives/rootless';
import { Button, cn, Hotkey } from '@ui';
import { type Component, Show } from 'solid-js';
import type { EmailThreadListNavigation } from '../context/email-thread-context';
import { useEmailThreadState } from '../context/email-thread-state-context';
import { useEmailThreadViewContext } from '../context/email-thread-view-context';
import { openEmailReplyComposerForMessage } from '../primitives/reply-actions';

function ReplyActionButton(props: {
  icon: Component<{ class?: string }>;
  label?: string;
  ariaLabel?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="secondary"
      aria-label={props.ariaLabel}
      disabled={props.disabled}
      class={cn(
        // Island pills when floating in the mobile/tablet accessory region.
        'touch:island touch:bg-chrome touch:text-ink touch:h-8 touch:border-0',
        !props.label && 'touch:w-9 touch:p-0'
      )}
      onClick={props.onClick}
    >
      <props.icon
        class={cn('size-4 shrink-0', !props.label && 'touch:size-6')}
      />
      <Show when={props.label}>
        <span>{props.label}</span>
      </Show>
    </Button>
  );
}

function ReplyShortcutButton(props: {
  icon: Component<{ class?: string }>;
  label: string;
  hotkey: HotkeyToken;
  variant?: 'secondary';
  onClick: () => void;
}) {
  return (
    <Button
      variant={props.variant ?? 'ghost'}
      class="gap-2 pr-1.5"
      onClick={props.onClick}
    >
      <props.icon class="size-4 shrink-0" />
      <span>{props.label}</span>
      <Hotkey
        token={props.hotkey}
        class="h-5 min-w-5 justify-center rounded-sm bg-ink/8 px-1 text-xs text-ink-muted"
      />
    </Button>
  );
}

export function BottomReplyButtons(props: {
  lastMessage: EmailMessage;
  navigation?: EmailThreadListNavigation;
}) {
  const ctx = useEmailThreadState();
  const viewContext = useEmailThreadViewContext();

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
        <div class="flex w-full flex-wrap items-center gap-2 pt-4">
          <ReplyShortcutButton
            icon={ArrowBendUpLeft}
            label="Reply"
            hotkey={TOKENS.email.reply}
            variant="secondary"
            onClick={open('reply')}
          />
          <ReplyShortcutButton
            icon={ArrowBendDoubleUpLeft}
            label="Reply all"
            hotkey={TOKENS.email.replyAll}
            onClick={open('reply-all')}
          />
          <ReplyShortcutButton
            icon={ArrowRight}
            label="Forward"
            hotkey={TOKENS.email.forward}
            onClick={open('forward')}
          />
        </div>
      }
    >
      <FloatRegionOrInline region="accessory">
        <div class="w-full p-2 pb-2 pt-4 touch:px-(--mobile-chrome-gutter) touch:py-0">
          <div class="flex flex-row flex-wrap items-center gap-2 justify-between touch:pointer-events-auto">
            <div class="flex flex-row items-center gap-2">
              <ReplyActionButton
                icon={ArrowBendUpLeft}
                label="Reply"
                onClick={open('reply-all')}
              />
              <Show when={ctx.permissions().isOwner}>
                <ReplyActionButton
                  icon={ArrowBendUpRight}
                  label="Forward"
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
                      ariaLabel="Previous email"
                      disabled={!navigation().canPrevious()}
                      onClick={() => navigation().previous()}
                    />
                    <ReplyActionButton
                      icon={ArrowDown}
                      ariaLabel="Next email"
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
                  ariaLabel={isDone() ? 'Mark as not done' : 'Mark done'}
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

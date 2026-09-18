import type { ReplyType } from '@app/features/email-compose/core/reply-type';
import type { EmailMessage } from '@app/features/email-message/core/email-message';
import { FloatRegionOrInline } from '@components/app/mobile/float-regions/FloatRegion';
import { inboxIconProps } from '@core/component/inboxIcon';
import { UserIcon } from '@core/component/UserIcon';
import ArrowBendUpLeft from '@phosphor/arrow-bend-up-left.svg';
import ArrowBendUpRight from '@phosphor/arrow-bend-up-right.svg';
import ArrowDown from '@phosphor/arrow-down.svg';
import ArrowUp from '@phosphor/arrow-up.svg';
import CheckIcon from '@phosphor/check.svg';
import CheckBoldIcon from '@phosphor-icons/core/bold/check-bold.svg?component-solid';
import { createCallback } from '@solid-primitives/rootless';
import { Button, cn } from '@ui';
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
  const viewContext = useEmailThreadViewContext();
  return (
    <Button
      // Button wraps itself in Layer depth={0} by default; in the floating
      // accessory region, match the chrome's depth so the island surface
      // matches the dock buttons. (The region host's Layer can't help —
      // Button's own Layer would reset it.)
      depth={viewContext.thread.isTouch() ? 3 : undefined}
      variant="outline"
      aria-label={props.ariaLabel}
      disabled={props.disabled}
      class={cn(
        // Island pills when floating in the mobile/tablet accessory region.
        'touch:island touch:h-8 touch:rounded-full touch:border-0',
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
        isMobile: viewContext.thread.isMobile(),
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

  const isDone = () => ctx.isThreadDone();

  // Matches TopBar: a send-only thread is permanently done, so the toggle
  // would be a no-op in both directions.
  const showMarkDoneToggle = () => !isDone() || ctx.canMarkThreadNotDone();

  const toggleMarkDone = () => {
    if (isDone()) {
      ctx.markThreadNotDone();
    } else if (props.navigation) {
      props.navigation.markDone(ctx.archiveThread);
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
            <span class="truncate">Reply...</span>
          </button>
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
              <ReplyActionButton
                icon={ArrowBendUpRight}
                label="Forward"
                onClick={open('forward')}
              />
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

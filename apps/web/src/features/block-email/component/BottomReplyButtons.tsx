import { FloatRegionOrInline } from '@components/app/mobile/float-regions/FloatRegion';
import { inboxIconProps } from '@core/component/inboxIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useEmail } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ArrowBendUpLeft from '@phosphor/arrow-bend-up-left.svg';
import ArrowBendUpRight from '@phosphor/arrow-bend-up-right.svg';
import CheckIcon from '@phosphor/check.svg';
import CheckBoldIcon from '@phosphor-icons/core/bold/check-bold.svg?component-solid';
import type { ApiMessage } from '@service-email/generated/schemas';
import { createCallback } from '@solid-primitives/rootless';
import { Button, cn } from '@ui';
import { type Component, Show } from 'solid-js';
import type { ReplyType } from '../util/replyType';
import { useEmailContext } from './EmailContext';
import { openEmailReplyComposerForMessage } from './emailReplyActions';

function ReplyActionButton(props: {
  icon: Component<{ class?: string }>;
  label?: string;
  ariaLabel?: string;
  onClick: () => void;
}) {
  return (
    <Button
      // Button wraps itself in Layer depth={0} by default; in the floating
      // accessory region, match the chrome's depth so the island surface
      // matches the dock buttons. (The region host's Layer can't help —
      // Button's own Layer would reset it.)
      depth={isTouchDevice() ? 3 : undefined}
      variant="outline"
      aria-label={props.ariaLabel}
      class={cn(
        // Island pills when floating in the mobile/tablet accessory region.
        'touch:island touch:h-8 touch:rounded-full touch:border-0'
      )}
      onClick={props.onClick}
    >
      <props.icon class="size-4 shrink-0" />
      <Show when={props.label}>
        <span>{props.label}</span>
      </Show>
    </Button>
  );
}

export function BottomReplyButtons(props: { lastMessage: ApiMessage }) {
  const ctx = useEmailContext();
  const currentUserEmail = useEmail();

  const open = (type: ReplyType) =>
    createCallback(() => {
      const messageId = props.lastMessage.db_id;
      if (!messageId) return;
      openEmailReplyComposerForMessage({
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
    } else {
      ctx.archiveThread();
    }
  };

  return (
    <Show
      when={isTouchDevice()}
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
          <div class="flex flex-row items-center gap-2 justify-between touch:pointer-events-auto">
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

            <Show when={showMarkDoneToggle()}>
              <ReplyActionButton
                icon={(iconProps) => (
                  <Show
                    when={isDone()}
                    fallback={<CheckIcon class={iconProps.class} />}
                  >
                    <CheckBoldIcon class={cn(iconProps.class, 'text-accent')} />
                  </Show>
                )}
                ariaLabel={isDone() ? 'Mark as not done' : 'Mark done'}
                onClick={toggleMarkDone}
              />
            </Show>
          </div>
        </div>
      </FloatRegionOrInline>
    </Show>
  );
}

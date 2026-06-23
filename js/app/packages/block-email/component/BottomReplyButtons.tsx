import { FloatRegionOrInline } from '@app/component/mobile/float-regions/FloatRegion';
import { useEmail } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import ArrowBendDoubleUpLeft from '@phosphor/arrow-bend-double-up-left.svg';
import ArrowBendUpLeft from '@phosphor/arrow-bend-up-left.svg';
import ArrowBendUpRight from '@phosphor/arrow-bend-up-right.svg';
import type { ApiMessage } from '@service-email/generated/schemas';
import { createCallback } from '@solid-primitives/rootless';
import { Button, cn } from '@ui';
import { type Component, Show } from 'solid-js';
import { isReplyAllEligible } from '../util/recipientConversion';
import type { ReplyType } from '../util/replyType';
import { useEmailContext } from './EmailContext';
import { getEmailFormRegistry } from './EmailFormContext';

function ReplyActionButton(props: {
  icon: Component<{ class?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="base"
      size="sm"
      // Button wraps itself in Layer depth={0} by default; in the floating
      // accessory region, match the chrome's depth so the island surface
      // matches the dock buttons. (The region host's Layer can't help —
      // Button's own Layer would reset it.)
      depth={isMobile() ? 4 : undefined}
      class={cn(
        'rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:text-ink border border-ink-muted/8 bg-ink-muted/2.5 hover:bg-ink-muted/6',
        // Island pills when floating in the mobile accessory region.
        'mobile:island mobile:h-8 mobile:rounded-full mobile:border-0'
      )}
      onClick={props.onClick}
    >
      <props.icon class="size-3.5" />
      <span>{props.label}</span>
    </Button>
  );
}

export function BottomReplyButtons(props: { lastMessage: ApiMessage }) {
  const ctx = useEmailContext();
  const formRegistry = getEmailFormRegistry();
  const userEmail = useEmail();

  const shouldShowReplyAll = () =>
    isReplyAllEligible(props.lastMessage, userEmail() ?? '');

  const open = (type: ReplyType) =>
    createCallback(() => {
      const messageId = props.lastMessage.db_id;
      if (!messageId) return;
      const form = formRegistry.getOrInit({
        type: 'replying_to',
        messageID: messageId,
      });
      form.setReplyType(type);
      form.setShouldFocusInput(true);
      ctx.messages.setBottomReplyOpen(true);
    });

  return (
    <FloatRegionOrInline region="accessory">
      <div class="w-full pt-2 pb-1 mobile:py-0 mobile:px-(--mobile-chrome-gutter)">
        <div class="flex flex-row items-center gap-2 mobile:pointer-events-auto">
          <ReplyActionButton
            icon={ArrowBendUpLeft}
            label="Reply"
            onClick={open('reply')}
          />
          <Show when={shouldShowReplyAll()}>
            <ReplyActionButton
              icon={ArrowBendDoubleUpLeft}
              label="Reply all"
              onClick={open('reply-all')}
            />
          </Show>
          <ReplyActionButton
            icon={ArrowBendUpRight}
            label="Forward"
            onClick={open('forward')}
          />
        </div>
      </div>
    </FloatRegionOrInline>
  );
}

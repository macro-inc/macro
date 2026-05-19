import { useEmail } from '@core/context/user';
import ArrowBendDoubleUpLeft from '@phosphor/arrow-bend-double-up-left.svg';
import ArrowBendUpLeft from '@phosphor/arrow-bend-up-left.svg';
import ArrowBendUpRight from '@phosphor/arrow-bend-up-right.svg';
import type { ApiMessage } from '@service-email/generated/schemas';
import { createCallback } from '@solid-primitives/rootless';
import { Button } from '@ui';
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
      class="rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:text-ink border border-ink-muted/8 bg-ink-muted/2.5 hover:bg-ink-muted/6"
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
    <div class="w-full pt-2 pb-1">
      <div class="flex flex-row items-center gap-2">
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
  );
}

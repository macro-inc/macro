import { useEmail } from '@core/context/user';
import ArrowBendDoubleUpLeft from '@icon/regular/arrow-bend-double-up-left.svg';
import ArrowBendUpLeft from '@icon/regular/arrow-bend-up-left.svg';
import ArrowBendUpRight from '@icon/regular/arrow-bend-up-right.svg';
import type { ApiMessage } from '@service-email/generated/schemas';
import { createCallback } from '@solid-primitives/rootless';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { isReplyAllEligible } from '../util/recipientConversion';
import type { ReplyType } from '../util/replyType';
import { useEmailContext } from './EmailContext';
import { getEmailFormRegistry } from './EmailFormContext';

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
        <Button
          variant="base"
          size="sm"
          class="rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:text-ink border border-ink-muted/8 bg-ink-muted/[0.025] hover:bg-ink-muted/[0.06]"
          onClick={open('reply')}
        >
          <ArrowBendUpLeft class="size-3.5" />
          <span>Reply</span>
        </Button>
        <Show when={shouldShowReplyAll()}>
          <Button
            variant="base"
            size="sm"
            class="rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:text-ink border border-ink-muted/8 bg-ink-muted/[0.025] hover:bg-ink-muted/[0.06]"
            onClick={open('reply-all')}
          >
            <ArrowBendDoubleUpLeft class="size-3.5" />
            <span>Reply all</span>
          </Button>
        </Show>
        <Button
          variant="base"
          size="sm"
          class="rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:text-ink border border-ink-muted/8 bg-ink-muted/[0.025] hover:bg-ink-muted/[0.06]"
          onClick={open('forward')}
        >
          <ArrowBendUpRight class="size-3.5" />
          <span>Forward</span>
        </Button>
      </div>
    </div>
  );
}

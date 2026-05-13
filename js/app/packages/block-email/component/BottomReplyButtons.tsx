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
    <div class="w-full border-t border-edge-muted pt-3 pb-2">
      <div class="flex flex-row items-center gap-2 pl-[calc(var(--user-icon-width)+2*var(--message-padding-x))]">
        <Button
          variant="base"
          size="md"
          class="rounded-full px-4 py-1"
          onClick={open('reply')}
        >
          <ArrowBendUpLeft class="size-4" />
          <span>Reply</span>
        </Button>
        <Show when={shouldShowReplyAll()}>
          <Button
            variant="base"
            size="md"
            class="rounded-full px-4 py-1"
            onClick={open('reply-all')}
          >
            <ArrowBendDoubleUpLeft class="size-4" />
            <span>Reply all</span>
          </Button>
        </Show>
        <Button
          variant="base"
          size="md"
          class="rounded-full px-4 py-1"
          onClick={open('forward')}
        >
          <ArrowBendUpRight class="size-4" />
          <span>Forward</span>
        </Button>
      </div>
    </div>
  );
}

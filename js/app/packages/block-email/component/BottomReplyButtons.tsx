import ArrowBendUpLeft from '@icon/regular/arrow-bend-up-left.svg';
import ArrowBendUpRight from '@icon/regular/arrow-bend-up-right.svg';
import type { ApiMessage } from '@service-email/generated/schemas';
import { createCallback } from '@solid-primitives/rootless';
import { Button } from '@ui';
import type { ReplyType } from '../util/replyType';
import { useEmailContext } from './EmailContext';
import { getEmailFormRegistry } from './EmailFormContext';

export function BottomReplyButtons(props: { lastMessage: ApiMessage }) {
  const ctx = useEmailContext();
  const formRegistry = getEmailFormRegistry();

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
    <div class="w-full border-t border-edge-muted flex flex-row items-center justify-center gap-2 pt-3 pb-2">
      <Button
        variant="base"
        size="md"
        class="rounded-full px-4 py-1"
        onClick={open('reply')}
      >
        <ArrowBendUpLeft class="size-4" />
        <span>Reply</span>
      </Button>
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
  );
}

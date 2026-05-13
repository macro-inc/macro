import { isReplyAllEligible } from '@block-email/util/recipientConversion';
import type { ReplyType } from '@block-email/util/replyType';
import { useEmail } from '@core/context/user';
import ArrowBendDoubleUpLeft from '@icon/regular/arrow-bend-double-up-left.svg';
import ArrowBendUpLeft from '@icon/regular/arrow-bend-up-left.svg';
import ArrowBendUpRight from '@icon/regular/arrow-bend-up-right.svg';
import type { ApiMessage } from '@service-email/generated/schemas';
import { createCallback } from '@solid-primitives/rootless';
import { Button } from '@ui';
import { type Setter, Show } from 'solid-js';
import { getEmailFormRegistry } from './EmailFormContext';

const EMAIL_MESSAGE_ACTIONS = ['reply', 'reply-all', 'forward'] as const;
export type EmailMessageAction = (typeof EMAIL_MESSAGE_ACTIONS)[number];

export function MessageActions(props: {
  message: ApiMessage;
  showActions: boolean;
  setShowReply: Setter<boolean>;
  isLastMessage?: boolean;
  hiddenActions?: EmailMessageAction[];
}) {
  const formRegistry = getEmailFormRegistry();
  const userEmail = useEmail();
  const shouldShowReplyAll = () =>
    isReplyAllEligible(props.message, userEmail() ?? '');

  const canShowActions = () => {
    if (!props.showActions) return false;

    const allActionsHidden = props.hiddenActions?.every((a) =>
      EMAIL_MESSAGE_ACTIONS.includes(a)
    );

    return !allActionsHidden;
  };

  const onChangeReplyType = (type: ReplyType) => {
    return createCallback(() => {
      props.setShowReply(true);
      const form = formRegistry.getOrInit({
        type: 'replying_to',
        messageID: props.message.db_id ?? '',
      });
      form.setReplyType(type);
      form.setShouldFocusInput(true);
    });
  };

  return (
    <div
      class="flex flex-row items-center gap-1 transition-opacity"
      classList={{
        'opacity-0 pointer-events-none': !canShowActions(),
        'opacity-100': canShowActions(),
      }}
    >
      <Show when={!props.hiddenActions?.includes('reply')}>
        <Button
          class="size-8 p-0 border-0 bg-transparent hover:bg-hover hover-transition-bg text-ink gap-0.5 active:bg-hover active:text-ink active:border-transparent"
          onClick={onChangeReplyType('reply')}
          tooltip="Reply"
        >
          <ArrowBendUpLeft class="size-5" />
        </Button>
      </Show>
      <Show
        when={
          shouldShowReplyAll() && !props.hiddenActions?.includes('reply-all')
        }
      >
        <Button
          class="size-8 p-0 border-0 bg-transparent hover:bg-hover hover-transition-bg text-ink gap-0.5 active:bg-hover active:text-ink active:border-transparent"
          onClick={onChangeReplyType('reply-all')}
          tooltip="Reply all"
        >
          <ArrowBendDoubleUpLeft class="size-5" />
        </Button>
      </Show>
      <Show when={!props.hiddenActions?.includes('forward')}>
        <Button
          class="size-8 p-0 border-0 bg-transparent hover:bg-hover hover-transition-bg text-ink gap-0.5 active:bg-hover active:text-ink active:border-transparent"
          onClick={onChangeReplyType('forward')}
          tooltip="Forward"
        >
          <ArrowBendUpRight class="size-5" />
        </Button>
      </Show>
    </div>
  );
}

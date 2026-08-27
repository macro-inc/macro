import type { ReplyType } from '@block-email/util/replyType';
import ArrowBendUpLeft from '@phosphor/arrow-bend-up-left.svg';
import ArrowBendUpRight from '@phosphor/arrow-bend-up-right.svg';
import type { ApiMessage } from '@service-email/generated/schemas';
import { createCallback } from '@solid-primitives/rootless';
import { Button } from '@ui';
import { type Setter, Show } from 'solid-js';
import { useEmailContext } from './EmailContext';
import { openEmailReplyComposerForMessage } from './emailReplyActions';

const EMAIL_MESSAGE_ACTIONS = ['reply', 'reply-all', 'forward'] as const;
export type EmailMessageAction = (typeof EMAIL_MESSAGE_ACTIONS)[number];

export function MessageActions(props: {
  message: ApiMessage;
  showActions: boolean;
  setShowReply: Setter<boolean>;
  isLastMessage?: boolean;
  hiddenActions?: EmailMessageAction[];
}) {
  const ctx = useEmailContext();

  const canShowActions = () => {
    if (!props.showActions) return false;

    const allActionsHidden = props.hiddenActions?.every((a) =>
      EMAIL_MESSAGE_ACTIONS.includes(a)
    );

    return !allActionsHidden;
  };

  const onChangeReplyType = (type: ReplyType) => {
    return createCallback(() => {
      openEmailReplyComposerForMessage({
        ctx,
        message: props.message,
        replyType: type,
        isLastMessage: props.isLastMessage,
        setShowReply: props.setShowReply,
      });
    });
  };

  return (
    <div
      class="flex flex-row items-center gap-0.5"
      classList={{
        'opacity-0 pointer-events-none': !canShowActions(),
        'opacity-100': canShowActions(),
      }}
    >
      <Show when={!props.hiddenActions?.includes('reply')}>
        <Button
          class="size-6 p-0 border-0 bg-transparent rounded text-ink-muted hover:text-ink hover:bg-ink-muted/8"
          onClick={onChangeReplyType('reply-all')}
          tooltip="Reply"
        >
          <ArrowBendUpLeft class="size-3.5" />
        </Button>
      </Show>
      <Show when={!props.hiddenActions?.includes('forward')}>
        <Button
          class="size-6 p-0 border-0 bg-transparent rounded text-ink-muted hover:text-ink hover:bg-ink-muted/8"
          onClick={onChangeReplyType('forward')}
          tooltip="Forward"
        >
          <ArrowBendUpRight class="size-3.5" />
        </Button>
      </Show>
    </div>
  );
}

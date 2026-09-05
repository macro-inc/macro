import type { EmailMessage } from '@app/features/email-message/core/email-message';
import ArrowBendUpLeft from '@phosphor/arrow-bend-up-left.svg';
import ArrowBendUpRight from '@phosphor/arrow-bend-up-right.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';

const EMAIL_MESSAGE_ACTIONS = ['reply', 'reply-all', 'forward'] as const;
export type EmailMessageAction = (typeof EMAIL_MESSAGE_ACTIONS)[number];

export function MessageActions(props: {
  message: EmailMessage;
  showActions: boolean;
  onReply?: (action: EmailMessageAction) => void;
  hiddenActions?: EmailMessageAction[];
}) {
  const canShowActions = () =>
    props.showActions &&
    !!props.onReply &&
    !EMAIL_MESSAGE_ACTIONS.every((action) =>
      props.hiddenActions?.includes(action)
    );
  const onChangeReplyType = (action: EmailMessageAction) => () =>
    props.onReply?.(action);

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
          noTouchResize
          onClick={onChangeReplyType('reply-all')}
          tooltip="Reply"
        >
          <ArrowBendUpLeft class="size-3.5" />
        </Button>
      </Show>
      <Show when={!props.hiddenActions?.includes('forward')}>
        <Button
          class="size-6 p-0 border-0 bg-transparent rounded text-ink-muted hover:text-ink hover:bg-ink-muted/8"
          noTouchResize
          onClick={onChangeReplyType('forward')}
          tooltip="Forward"
        >
          <ArrowBendUpRight class="size-3.5" />
        </Button>
      </Show>
    </div>
  );
}

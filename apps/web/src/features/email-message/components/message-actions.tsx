import type { EmailMessage } from '@app/features/email-message/core/email-message';
import { TOKENS } from '@core/hotkey/tokens';
import ArrowBendUpLeft from '@icon/system/regular/arrow-bend-up-left.svg';
import ArrowBendUpRight from '@icon/system/regular/arrow-bend-up-right.svg';
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
          variant="ghost"
          size="icon-sm"
          class="size-6 p-0"
          onClick={onChangeReplyType('reply-all')}
          tooltip={{ content: 'Reply', hotkey: TOKENS.email.reply }}
        >
          <ArrowBendUpLeft class="size-3.5" />
        </Button>
      </Show>
      <Show when={!props.hiddenActions?.includes('forward')}>
        <Button
          variant="ghost"
          size="icon-sm"
          class="size-6 p-0"
          onClick={onChangeReplyType('forward')}
          tooltip={{ content: 'Forward', hotkey: TOKENS.email.forward }}
        >
          <ArrowBendUpRight class="size-3.5" />
        </Button>
      </Show>
    </div>
  );
}

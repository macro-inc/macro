import type { EmailMessage } from '@app/features/email-message/core/email-message';
import { t } from '@app/lib/i18n';
import { TOKENS } from '@core/hotkey/tokens';
import ArrowBendDoubleUpLeft from '@icon/system/regular/arrow-bend-double-up-left.svg';
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
          aria-label={t('emailThread.reply')}
          onClick={onChangeReplyType('reply')}
          tooltip={{
            content: t('emailThread.reply'),
            hotkey: TOKENS.email.reply,
          }}
        >
          <ArrowBendUpLeft class="size-3.5" />
        </Button>
      </Show>
      <Show when={!props.hiddenActions?.includes('reply-all')}>
        <Button
          variant="ghost"
          size="icon-sm"
          class="size-6 p-0"
          aria-label={t('emailThread.replyAll')}
          onClick={onChangeReplyType('reply-all')}
          tooltip={{
            content: t('emailThread.replyAll'),
            shortcut: 'enter',
          }}
        >
          <ArrowBendDoubleUpLeft class="size-3.5" />
        </Button>
      </Show>
      <Show when={!props.hiddenActions?.includes('forward')}>
        <Button
          variant="ghost"
          size="icon-sm"
          class="size-6 p-0"
          aria-label={t('emailThread.forward')}
          onClick={onChangeReplyType('forward')}
          tooltip={{
            content: t('emailThread.forward'),
            hotkey: TOKENS.email.forward,
          }}
        >
          <ArrowBendUpRight class="size-3.5" />
        </Button>
      </Show>
    </div>
  );
}

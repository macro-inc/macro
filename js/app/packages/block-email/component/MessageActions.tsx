import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import ArrowBendDoubleUpLeft from '@icon/regular/arrow-bend-double-up-left.svg';
import ArrowBendUpLeft from '@icon/regular/arrow-bend-up-left.svg';
import ArrowBendUpRight from '@icon/regular/arrow-bend-up-right.svg';
import type { MessageWithBodyReplyless } from '@service-email/generated/schemas';
import { useEmail } from '@service-gql/client';
import { type Setter, Show } from 'solid-js';
import { getEmailFormRegistry } from './EmailFormContext';
import type { ReplyType } from '@block-email/util/replyType';

const EMAIL_MESSAGE_ACTIONS = ['reply', 'reply-all', 'forward'] as const;
export type EmailMessageAction = (typeof EMAIL_MESSAGE_ACTIONS)[number];

export function MessageActions(props: {
  message: MessageWithBodyReplyless;
  showActions: boolean;
  setShowReply: Setter<boolean>;
  isLastMessage?: boolean;
  hiddenActions?: EmailMessageAction[];
}) {
  const formRegistry = getEmailFormRegistry();
  const userEmail = useEmail();
  const filteredTo = () => {
    return props.message.to.filter((to) => to.email !== userEmail());
  };
  const filteredCc = () => {
    return props.message.cc.filter((cc) => cc.email !== userEmail());
  };
  const shouldShowReplyAll = () => {
    return filteredTo().length + filteredCc().length > 1;
  };

  const canShowActions = () => {
    if (!props.showActions) return false;

    const allActionsHidden = props.hiddenActions?.every((a) =>
      EMAIL_MESSAGE_ACTIONS.includes(a)
    );

    return !allActionsHidden;
  };

  const onChangeReplyType = (type: ReplyType) => {
    return () => {
      if (!props.isLastMessage) {
        props.setShowReply(true);
      }
      const form = formRegistry.getOrInit({
        type: 'replying_to',
        messageID: props.message.db_id ?? '',
      });
      form.setReplyType(type);
      form.setShouldFocusInput(true);
    };
  };

  return (
    <div
      class="flex flex-row items-center gap-4 transition-opacity"
      classList={{
        'opacity-0 pointer-events-none': !canShowActions(),
        'opacity-100': canShowActions(),
      }}
    >
      <Show
        when={
          shouldShowReplyAll() && !props.hiddenActions?.includes('reply-all')
        }
        fallback={
          <Show when={!props.hiddenActions?.includes('reply')}>
            <DeprecatedIconButton
              icon={ArrowBendUpLeft}
              theme="clear"
              onClick={onChangeReplyType('reply')}
              tooltip={{
                label: 'Reply',
              }}
            />
          </Show>
        }
      >
        <DeprecatedIconButton
          icon={ArrowBendDoubleUpLeft}
          theme="clear"
          onClick={onChangeReplyType('reply-all')}
          tooltip={{
            label: 'Reply all',
          }}
        />
      </Show>
      <Show when={!props.hiddenActions?.includes('forward')}>
        <DeprecatedIconButton
          icon={ArrowBendUpRight}
          theme="clear"
          onClick={onChangeReplyType('forward')}
          tooltip={{
            label: 'Forward',
          }}
        />
      </Show>
    </div>
  );
}

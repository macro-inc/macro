import { IconButton } from '@core/component/IconButton';
import ArrowBendDoubleUpLeft from '@icon/regular/arrow-bend-double-up-left.svg';
import ArrowBendUpLeft from '@icon/regular/arrow-bend-up-left.svg';
import ArrowBendUpRight from '@icon/regular/arrow-bend-up-right.svg';
import type { MessageWithBodyReplyless } from '@service-email/generated/schemas';
// import EnvelopSimple from '@icon/regular/envelope-simple.svg';
import { useEmail } from '@service-gql/client';
import { type Setter, Show } from 'solid-js';
import { getEmailFormRegistry } from './EmailFormContext';

export function MessageActions(props: {
  message: MessageWithBodyReplyless;
  showActions: boolean;
  setShowReply: Setter<boolean>;
  isLastMessage?: boolean;
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

  return (
    <Show when={props.showActions}>
      <div class="flex flex-row items-center gap-4">
        <Show
          when={shouldShowReplyAll()}
          fallback={
            <IconButton
              icon={ArrowBendUpLeft}
              theme="clear"
              onClick={() => {
                if (!props.isLastMessage) {
                  props.setShowReply(true);
                }
                const form = formRegistry.getOrInit(props.message.db_id ?? '');
                form.setReplyType('reply');
                form.setShouldFocusInput(true);
              }}
              tooltip={{
                label: 'Reply',
              }}
            />
          }
        >
          <IconButton
            icon={ArrowBendDoubleUpLeft}
            theme="clear"
            onClick={() => {
              if (!props.isLastMessage) {
                props.setShowReply(true);
              }
              const form = formRegistry.getOrInit(props.message.db_id ?? '');
              form.setReplyType('reply-all');
              form.setShouldFocusInput(true);
            }}
            tooltip={{
              label: 'Reply all',
            }}
          />
        </Show>
        <IconButton
          icon={ArrowBendUpRight}
          theme="clear"
          onClick={() => {
            if (!props.isLastMessage) {
              props.setShowReply(true);
            }
            const form = formRegistry.getOrInit(props.message.db_id ?? '');
            form.setReplyType('forward');
            form.setShouldFocusInput(true);
          }}
          tooltip={{
            label: 'Forward',
          }}
        />
        {/* <IconButton
          icon={EnvelopSimple}
          theme="clear"
          onClick={async () => {
            // TODO: Implement mark as unread
          }}
          tooltip={{
            label: 'Mark as unread',
          }}
        /> */}
      </div>
    </Show>
  );
}

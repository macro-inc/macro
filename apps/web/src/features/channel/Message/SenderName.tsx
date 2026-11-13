import { useAgentProfile } from '@app/features/agent-dashboards/agent-profile';
import { t } from '@app/lib/i18n';
import type { MessageData } from '@core/messages/types';
import { getDisplayName, tryMacroId } from '@core/user';
import { getBotDisplayName } from '@queries/messages/message-sender';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { useMessage } from './context';

type SenderNameProps = {
  class?: string;
  hidden?: boolean;
};

export function MessageSenderName(props: SenderNameProps) {
  const message = useMessage();
  const agentProfile = useAgentProfile();
  // An agent teammate's name opens its profile; a person's stays plain text.
  const profileId = () =>
    message().guest_name
      ? undefined
      : agentProfile.profileOf(message().sender_id);

  return (
    <Show when={!props.hidden}>
      <Show
        when={profileId()}
        fallback={
          <span class={cn('text-sm font-medium truncate', props.class)}>
            <SenderName message={message()} />
          </span>
        }
      >
        {(id) => (
          <button
            type="button"
            class={cn(
              'min-w-0 cursor-default truncate rounded-sm text-left text-sm font-medium not-touch:hover:underline focus-visible:outline-2 focus-visible:outline-accent',
              props.class
            )}
            aria-label={t('agentDashboards.openProfileOf', {
              name: getDisplayName(tryMacroId(id())),
            })}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              agentProfile.open(id(), 'sender-name', event);
            }}
          >
            <SenderName message={message()} />
          </button>
        )}
      </Show>
    </Show>
  );
}

export function SenderName(props: { message: MessageData }) {
  const macroId = () => tryMacroId(props.message.sender_id);
  const displayName = () => getDisplayName(macroId());
  const agentName = () =>
    getBotDisplayName(props.message.sender_id, props.message.sender);
  const importedName = () => {
    const name = props.message.imported_author?.name?.trim();
    return name ? name : undefined;
  };
  return (
    <>
      {props.message.guest_name
        ? `${props.message.guest_name} (Guest)`
        : (importedName() ?? agentName() ?? displayName())}
    </>
  );
}

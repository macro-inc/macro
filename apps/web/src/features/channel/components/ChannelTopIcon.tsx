import { PersonaAvatar } from '@app/features/agent-dms/components/persona-avatar';
import { ChannelAvatar } from '@channel/channel-avatar';
import { UserIcon } from '@core/component/UserIcon';
import { useChannel, useChannelType } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { useChannelParticipantsQuery } from '@queries/channel/channel-participants';
import type { ChannelParticipant } from '@queries/channel/types';
import { queryReadyGate } from '@queries/gate';
import { ChannelType } from '@service-storage/generated/schemas/channelType';
import { Show } from 'solid-js';

export type ChannelTopIconProps = {
  channelId: string;
  channelType: ChannelType | undefined;
  participants: ChannelParticipant[];
  suppressClick?: boolean;
};

/** Channel avatar, or the other participant's avatar for a direct message. */
export function ChannelTopIcon(props: ChannelTopIconProps) {
  const channel = useChannel(props.channelId);
  const userId = useUserId();
  const recipient = () => {
    return props.participants.find((p) => p && p.user_id !== userId());
  };

  return (
    <Show
      when={channel()?.agent_dm}
      fallback={
        <Show
          when={props.channelType === ChannelType.direct_message && recipient()}
          fallback={
            <ChannelAvatar
              channelId={props.channelId}
              class="size-4 [&_img]:rounded-full"
            />
          }
        >
          {(recipient) => (
            <UserIcon
              id={recipient().user_id}
              isDeleted={false}
              size="sm"
              suppressClick={props.suppressClick}
              showTooltip={props.suppressClick ? false : undefined}
            />
          )}
        </Show>
      }
    >
      {(persona) => (
        <PersonaAvatar
          botId={persona().bot_id}
          name={persona().name}
          avatarUrl={persona().avatar_url}
          size="sm"
        />
      )}
    </Show>
  );
}

/** Resolve conversation identity for headers and navigation breadcrumbs. */
export function ChannelTitleIcon(props: {
  channelId: string;
  suppressClick?: boolean;
}) {
  return (
    <Show when={props.channelId} keyed>
      {(channelId) => {
        const channelType = useChannelType(channelId);
        const participants = useChannelParticipantsQuery(() => channelId);
        return (
          <ChannelTopIcon
            channelId={channelId}
            channelType={channelType()}
            participants={queryReadyGate(participants) ? participants.data : []}
            suppressClick={props.suppressClick}
          />
        );
      }}
    </Show>
  );
}

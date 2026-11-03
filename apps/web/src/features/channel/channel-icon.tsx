import { PersonaAvatar } from '@app/features/agent-dms/components/persona-avatar';
import { EntityIcon, type EntityIconProps } from '@core/component/EntityIcon';
import { UserIcon, type UserIconSize } from '@core/component/UserIcon';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import type { ChannelType } from '@service-storage/generated/schemas/channelType';
import { Show } from 'solid-js';
import { ChannelAvatar } from './channel-avatar';

export type ChannelIconProps = {
  channelId: string;
  channelType?: ChannelType | null;
  participantIds?: readonly string[];
  name?: string;
  avatarSize?: UserIconSize;
  class?: string;
  suppressClick?: boolean;
  showTooltip?: boolean;
  weight?: EntityIconProps['weight'];
  theme?: EntityIconProps['theme'];
};

function DirectMessageIcon(props: ChannelIconProps) {
  const userId = useUserId();
  const channels = useChannelsContext();
  const channel = () => channels.channelsById()[props.channelId];
  const agentDm = () => channel()?.agent_dm;
  const participantId = () => {
    const participants =
      props.participantIds ??
      channel()?.participants.map((participant) => participant.user_id) ??
      [];
    return participants.find((id) => id !== userId()) ?? participants[0];
  };

  return (
    <div class="size-full flex">
      <Show
        when={agentDm()}
        fallback={
          <Show
            when={participantId()}
            fallback={
              <EntityIcon
                targetType="direct_message"
                size="fill"
                class={props.class}
                weight={props.weight}
                theme={props.theme}
              />
            }
          >
            {(id) => (
              <Show
                when={id().startsWith('bot|')}
                fallback={
                  <UserIcon
                    id={id()}
                    isDeleted={false}
                    size={props.avatarSize ?? 'fill'}
                    class={props.class}
                    suppressClick={props.suppressClick}
                    showTooltip={props.showTooltip}
                  />
                }
              >
                <PersonaAvatar
                  botId={id().slice(4)}
                  name={props.name ?? channel()?.name ?? ''}
                  size={props.avatarSize ?? 'fill'}
                  class={props.class}
                />
              </Show>
            )}
          </Show>
        }
      >
        {(persona) => (
          <PersonaAvatar
            botId={persona().bot_id}
            name={persona().name}
            avatarUrl={persona().avatar_url}
            size={props.avatarSize ?? 'fill'}
            class={props.class}
          />
        )}
      </Show>
    </div>
  );
}

/** Shared conversation identity for entity rows, favorites, and headers. */
export function ChannelIcon(props: ChannelIconProps) {
  return (
    <Show
      when={props.channelType === 'direct_message'}
      fallback={
        <ChannelAvatar
          channelId={props.channelId}
          class={`size-full ${props.class ?? ''}`}
          fallback={
            <EntityIcon
              targetType="channel"
              size="fill"
              class={props.class}
              weight={props.weight}
              theme={props.theme}
            />
          }
        />
      }
    >
      <DirectMessageIcon {...props} />
    </Show>
  );
}

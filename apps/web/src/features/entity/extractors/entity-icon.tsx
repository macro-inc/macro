import { ChannelAvatar } from '@channel/channel-avatar';
import {
  EntityIcon as CoreEntityIcon,
  type EntityIconProps as CoreEntityIconProps,
  getEntityIconType,
} from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import type { StreamEvent } from '@service-connection/generated/schemas';
import { Match, Show, Switch } from 'solid-js';
import { ChatProviderIcon } from '../components/ChatProviderIcon';
import type { ChannelEntity, ChatEntity, EntityData } from '../types/entity';

interface EntityIconProps {
  entity: EntityData;
  streamState?: StreamEvent;
  class?: string;
  suppressClick?: boolean;
  showTooltip?: boolean;
  weight?: CoreEntityIconProps['weight'];
}

function DirectMessageIcon(props: {
  entity: ChannelEntity;
  class?: string;
  suppressClick?: boolean;
  showTooltip?: boolean;
  weight?: CoreEntityIconProps['weight'];
}) {
  const userId = useUserId();
  const participantId = () => {
    const participants = props.entity.participantIds ?? [];
    return participants.find((id) => id !== userId());
  };

  return (
    <div class="size-full flex">
      <Show
        when={participantId()}
        fallback={
          <CoreEntityIcon
            targetType="direct_message"
            size="fill"
            class={props.class}
            weight={props.weight}
          />
        }
      >
        {(id) => (
          <UserIcon
            id={id()}
            isDeleted={false}
            size="fill"
            class={props.class}
            suppressClick={props.suppressClick}
            showTooltip={props.showTooltip}
          />
        )}
      </Show>
    </div>
  );
}

export function EntityIcon(props: EntityIconProps) {
  const iconType = () => getEntityIconType(props.entity);
  const isDirectMessage = () =>
    props.entity.type === 'channel' &&
    props.entity.channelType === 'direct_message';

  const isChatEntity = () => props.entity.type === 'chat';
  const channelId = () => {
    const entity = props.entity;
    if (entity.type === 'channel') return entity.id;
    if (
      entity.type === 'channel_message' &&
      entity.channelType !== 'direct_message'
    )
      return entity.channelId;
  };

  return (
    <Switch
      fallback={
        <CoreEntityIcon
          targetType={iconType()}
          size="fill"
          class={props.class}
          weight={props.weight}
        />
      }
    >
      <Match when={isDirectMessage()}>
        <DirectMessageIcon
          entity={props.entity as ChannelEntity}
          class={props.class}
          suppressClick={props.suppressClick}
          showTooltip={props.showTooltip}
          weight={props.weight}
        />
      </Match>
      <Match when={channelId()}>
        {(id) => (
          <ChannelAvatar
            channelId={id()}
            class={`size-full ${props.class ?? ''}`}
            fallback={
              <CoreEntityIcon
                targetType={iconType()}
                size="fill"
                class={props.class}
                weight={props.weight}
              />
            }
          />
        )}
      </Match>
      <Match when={isChatEntity()}>
        <ChatProviderIcon
          id={props.entity.id}
          model={(props.entity as ChatEntity).model}
          animate={props.streamState?.type === 'created'}
          class={`size-full ${props.class ?? ''}`}
          weight={props.weight}
        />
      </Match>
    </Switch>
  );
}

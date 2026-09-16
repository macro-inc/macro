import {
  EntityIcon as CoreEntityIcon,
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
}

function DirectMessageIcon(props: {
  entity: ChannelEntity;
  class?: string;
  suppressClick?: boolean;
  showTooltip?: boolean;
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

  return (
    <Switch
      fallback={
        <CoreEntityIcon
          targetType={iconType()}
          size="fill"
          class={props.class}
        />
      }
    >
      <Match when={isDirectMessage()}>
        <DirectMessageIcon
          entity={props.entity as ChannelEntity}
          class={props.class}
          suppressClick={props.suppressClick}
          showTooltip={props.showTooltip}
        />
      </Match>
      <Match when={isChatEntity()}>
        <ChatProviderIcon
          id={props.entity.id}
          model={(props.entity as ChatEntity).model}
          animate={props.streamState?.type === 'created'}
          class={`size-full ${props.class ?? ''}`}
        />
      </Match>
    </Switch>
  );
}

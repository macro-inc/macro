import { ChannelIcon } from '@channel/channel-icon';
import {
  EntityIcon as CoreEntityIcon,
  type EntityIconProps as CoreEntityIconProps,
  getEntityIconType,
} from '@core/component/EntityIcon';
import { TaskStatusIcon } from '@core/component/TaskStatusIcon';
import type { StreamEvent } from '@service-connection/generated/schemas';
import { Match, Switch } from 'solid-js';
import { ChatProviderIcon } from '../components/ChatProviderIcon';
import {
  type ChatEntity,
  type EntityData,
  isTaskEntity,
} from '../types/entity';
import { getTaskStatusOptionId } from '../utils/task-properties';

interface EntityIconProps {
  entity: EntityData;
  streamState?: StreamEvent;
  class?: string;
  suppressClick?: boolean;
  showTooltip?: boolean;
  weight?: CoreEntityIconProps['weight'];
  theme?: CoreEntityIconProps['theme'];
}

export function EntityIcon(props: EntityIconProps) {
  const iconType = () => getEntityIconType(props.entity);
  const task = () => (isTaskEntity(props.entity) ? props.entity : undefined);
  const isChatEntity = () => props.entity.type === 'chat';
  const channel = () => {
    const entity = props.entity;
    if (entity.type === 'channel') {
      return {
        channelId: entity.id,
        channelType: entity.channelType,
        participantIds: entity.participantIds,
        name: entity.name,
      };
    }
    if (
      entity.type === 'channel_message' &&
      entity.channelType !== 'direct_message'
    ) {
      return { channelId: entity.channelId, channelType: entity.channelType };
    }
  };

  return (
    <Switch
      fallback={
        <CoreEntityIcon
          targetType={iconType()}
          size="fill"
          class={props.class}
          weight={props.weight}
          theme={props.theme}
        />
      }
    >
      <Match when={task()}>
        {(entity) => (
          <TaskStatusIcon
            statusId={getTaskStatusOptionId(entity())}
            completed={entity().subType.is_completed}
            size="fill"
            class={props.class}
            weight={props.weight}
            theme={props.theme}
          />
        )}
      </Match>
      <Match when={channel()}>
        {(identity) => (
          <ChannelIcon
            {...identity()}
            class={props.class}
            suppressClick={props.suppressClick}
            showTooltip={props.showTooltip}
            weight={props.weight}
            theme={props.theme}
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

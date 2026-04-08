import {
  EntityIcon as CoreEntityIcon,
  type EntityIconProps as CoreEntityIconProps,
  getIconConfig,
} from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import type { StreamEvent } from '@service-connection/generated/schemas';
import { Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { PulsingStar } from '../components/PulsingStar';
import type { ChannelEntity, EntityData } from '../types/entity';
import {
  isChannelEntity,
  isChannelMessageEntity,
  isTaskEntity,
} from '../types/entity';

interface EntityIconProps {
  entity: EntityData;
  streamState?: StreamEvent;
  class?: string;
}

function DirectMessageIcon(props: { entity: ChannelEntity; class?: string }) {
  const userId = useUserId();
  const participantId = () => {
    const participants = props.entity.participantIds ?? [];
    return participants.find((id) => id !== userId());
  };

  return (
    <div class={'bg-panel size-full rounded-full'}>
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
          />
        )}
      </Show>
    </div>
  );
}

export function EntityIcon(props: EntityIconProps) {
  const iconType = () => {
    return match(props.entity)
      .when(isChannelEntity, ({ channelType }) => channelType)
      .when(isChannelMessageEntity, ({ channelType }) => channelType)
      .when(isTaskEntity, () => 'task')
      .with({ type: 'document' }, ({ fileType }) => {
        return fileType ?? 'default';
      })
      .with({ type: 'chat' }, () => 'chat')
      .with({ type: 'project' }, () => 'project')
      .with({ type: 'email' }, ({ isRead, hasIcsAttachment }) =>
        hasIcsAttachment ? 'emailInvite' : isRead ? 'emailRead' : 'email'
      )
      .otherwise(() => 'default');
  };

  const validIconType = () => {
    const type = iconType();
    if (getIconConfig(type)) return type as CoreEntityIconProps['targetType'];
    else return 'default' as const;
  };

  const isDirectMessage = () => iconType() === 'direct_message';

  const isChatEntity = () => props.entity.type === 'chat';

  return (
    <Switch
      fallback={
        <CoreEntityIcon
          targetType={validIconType()}
          size="fill"
          class={props.class}
        />
      }
    >
      <Match when={isDirectMessage()}>
        <DirectMessageIcon
          entity={props.entity as ChannelEntity}
          class={props.class}
        />
      </Match>
      <Match when={isChatEntity()}>
        <PulsingStar
          kind="listIcon"
          animate={props.streamState?.type === 'created'}
          class={props.class}
        />
      </Match>
    </Switch>
  );
}

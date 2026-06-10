import {
  EntityIcon as CoreEntityIcon,
  type EntityIconProps as CoreEntityIconProps,
  getIconConfig,
} from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import GitMerge from '@phosphor/git-merge.svg';
import GitPullRequest from '@phosphor/git-pull-request.svg';
import type { StreamEvent } from '@service-connection/generated/schemas';
import { Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import { PulsingStar } from '../components/PulsingStar';
import type {
  ChannelEntity,
  EntityData,
  GithubPullRequestEntity,
} from '../types/entity';
import {
  isCallEntity,
  isChannelEntity,
  isChannelMessageEntity,
  isTaskEntity,
} from '../types/entity';

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

function GithubPullRequestIcon(props: {
  entity: GithubPullRequestEntity;
  class?: string;
}) {
  function config() {
    const status = props.entity.metadata.status;

    switch (status) {
      case 'open':
        return {
          icon: GitPullRequest,
          iconClass: 'text-success',
        };
      case 'merged':
        return {
          icon: GitMerge,
          iconClass: 'text-note',
        };
      case 'closed':
        return {
          icon: GitPullRequest,
          iconClass: 'text-failure',
        };
    }
  }

  return (
    <div class="size-full flex">
      <Dynamic component={config().icon} class={config().iconClass} />
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
      .when(isCallEntity, () => 'call')
      .with({ type: 'automation' }, () => 'automation')
      .with(
        { type: 'foreign', foreignSource: 'github_pull_request' },
        () => 'githubPullRequest'
      )
      .with({ type: 'foreign' }, () => 'default')
      .with({ type: 'crm_company' }, () => 'crm_company')
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
      <Match when={iconType() === 'githubPullRequest'}>
        <GithubPullRequestIcon
          entity={props.entity as GithubPullRequestEntity}
          class={props.class}
        />
      </Match>
      <Match when={isDirectMessage()}>
        <DirectMessageIcon
          entity={props.entity as ChannelEntity}
          class={props.class}
          suppressClick={props.suppressClick}
          showTooltip={props.showTooltip}
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

import {
  EntityIcon as CoreEntityIcon,
  type EntityIconProps as CoreEntityIconProps,
  getIconConfig,
} from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import GitMerge from '@phosphor/git-merge.svg';
import GitPullRequest from '@phosphor/git-pull-request.svg';
import GitMergeBold from '@phosphor-icons/core/bold/git-merge-bold.svg';
import GitPullRequestBold from '@phosphor-icons/core/bold/git-pull-request-bold.svg';
import type { StreamEvent } from '@service-connection/generated/schemas';
import { Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import { ChatProviderIcon } from '../components/ChatProviderIcon';
import type {
  ChannelEntity,
  ChatEntity,
  EntityData,
  GithubPullRequestEntity,
} from '../types/entity';
import {
  isCallEntity,
  isChannelEntity,
  isChannelMessageEntity,
  isSkillEntity,
  isSnippetEntity,
  isTaskEntity,
} from '../types/entity';

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

function GithubPullRequestIcon(props: {
  entity: GithubPullRequestEntity;
  class?: string;
  weight?: CoreEntityIconProps['weight'];
}) {
  function config() {
    const status = props.entity.metadata.status;

    switch (status) {
      case 'open':
        return {
          icon: props.weight === 'bold' ? GitPullRequestBold : GitPullRequest,
          iconClass: 'text-success',
        };
      case 'merged':
        return {
          icon: props.weight === 'bold' ? GitMergeBold : GitMerge,
          iconClass: 'text-note',
        };
      case 'closed':
        return {
          icon: props.weight === 'bold' ? GitPullRequestBold : GitPullRequest,
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
    return (
      match(props.entity)
        .when(isChannelEntity, ({ channelType }) => channelType)
        .when(isChannelMessageEntity, ({ channelType }) => channelType)
        .when(isTaskEntity, () => 'task')
        .when(isSnippetEntity, () => 'snippet')
        .when(isSkillEntity, () => 'skill')
        .with({ type: 'document' }, ({ fileType }) => {
          return fileType ?? 'default';
        })
        .with({ type: 'agent_session' }, () => 'agent')
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
        .with({ type: 'calendar_event' }, () => 'calendar')
        // Always the bell, never the referenced entity's icon: the row is a
        // reminder first, and what it points at is iconed beside its name
        // instead — see `reminderReferenceIconType`.
        .with({ type: 'reminder' }, () => 'reminder')
        .otherwise(() => 'default')
    );
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
          weight={props.weight}
        />
      }
    >
      <Match when={iconType() === 'githubPullRequest'}>
        <GithubPullRequestIcon
          entity={props.entity as GithubPullRequestEntity}
          class={props.class}
          weight={props.weight}
        />
      </Match>
      <Match when={isDirectMessage()}>
        <DirectMessageIcon
          entity={props.entity as ChannelEntity}
          class={props.class}
          suppressClick={props.suppressClick}
          showTooltip={props.showTooltip}
          weight={props.weight}
        />
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

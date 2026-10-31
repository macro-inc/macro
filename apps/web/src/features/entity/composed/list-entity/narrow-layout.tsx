import { isMobile } from '@core/mobile/isMobile';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { UnreadIndicator } from '../../components/UnreadIndicator';
import { Entity } from '../../entity';
import { TaskPropertyControl } from '../../extractors-property/task-property-control';
import {
  isChannelEntity,
  isChannelMessageEntity,
  isEmailEntity,
  isGithubPrEntity,
  isTaskEntity,
} from '../../types/entity';
import { isSearchEntity } from '../../types/search';
import {
  ChannelActiveCallBadge,
  ChannelJoinButton,
  ChannelMessageSingleLine,
} from './channel';
import { EmailInboxChip } from './email';
import { GithubPullRequestPills } from './foreign';
import { RowEnd } from './row-end';
import { SOUP_ROW_CLASS } from './row-geometry';
import { type LayoutProps, RowIndicator } from './shared';

export function NarrowLayout(props: LayoutProps) {
  const compactTask = () => isMobile() && isTaskEntity(props.entity);
  const pullRequest = () => {
    const entity = props.entity;
    return isGithubPrEntity(entity) ? entity : undefined;
  };
  return (
    <Entity.Layout
      class={cn(
        SOUP_ROW_CLASS.narrow,
        'w-full items-center text-sm pr-2 grid',
        compactTask()
          ? 'gap-x-0 pl-0'
          : 'gap-x-(--soup-row-column-gap) pl-(--soup-row-padding-l)'
      )}
      style={{
        'grid-template-columns': compactTask()
          ? '0.5rem minmax(0, 1fr) max-content'
          : 'var(--soup-row-indicator-width) 1fr max-content',
        'grid-template-rows': pullRequest() ? '44px auto' : '44px',
        'grid-template-areas': pullRequest()
          ? '"indicator title timestamp" ". body body"'
          : '"indicator title timestamp"',
      }}
    >
      <Entity.Slot placement="indicator" class="relative">
        <Show
          when={compactTask()}
          fallback={
            <RowIndicator
              checked={props.checked}
              hideCheckbox={props.hideCheckbox}
              onChecked={props.onChecked}
              unread={props.unread}
            />
          }
        >
          <UnreadIndicator active={props.unread} />
        </Show>
      </Entity.Slot>

      <Entity.Slot
        placement="title"
        class={cn(
          'ph-no-capture flex items-center gap-2 truncate font-semibold',
          compactTask() && 'gap-1'
        )}
      >
        <Show
          when={isTaskEntity(props.entity) ? props.entity : undefined}
          fallback={
            <div class="size-4 shrink-0">
              <Show
                when={props.icon}
                fallback={
                  <Entity.Icon
                    entity={props.entity}
                    streamState={props.streamState}
                  />
                }
              >
                {props.icon}
              </Show>
            </div>
          }
        >
          {(task) => <TaskPropertyControl entity={task()} property="status" />}
        </Show>
        <Show when={isTaskEntity(props.entity) ? props.entity : undefined}>
          {(task) => (
            <div
              class={cn(
                '-mr-1 flex shrink-0 items-center',
                compactTask() ? '-ml-1' : 'touch:-mr-2'
              )}
            >
              <TaskPropertyControl entity={task()} property="priority" />
            </div>
          )}
        </Show>
        {props.titleLeading}
        <Show
          when={isChannelMessageEntity(props.entity) && props.entity}
          fallback={<Entity.Title entity={props.entity} />}
        >
          {(entity) => <ChannelMessageSingleLine entity={entity()} />}
        </Show>
        {props.titleTrailing}
        <Show when={isEmailEntity(props.entity) && props.entity}>
          {(entity) => <EmailInboxChip entity={entity()} class="ml-auto" />}
        </Show>
        <Show when={isChannelEntity(props.entity) && props.entity}>
          {(entity) => (
            <span class="ml-auto shrink-0 flex items-center">
              <ChannelActiveCallBadge channelId={entity().id} />
            </span>
          )}
        </Show>
        <Show
          when={
            isChannelEntity(props.entity) &&
            props.entity.isParticipant === false &&
            props.entity
          }
        >
          {(entity) => (
            <ChannelJoinButton entity={entity()} class="ml-auto shrink-0" />
          )}
        </Show>
      </Entity.Slot>

      <Show when={pullRequest()}>
        {(review) => (
          <Entity.Slot
            placement="body"
            class="flex min-w-0 flex-wrap items-center gap-1.5 pb-2"
          >
            <GithubPullRequestPills
              entity={review()}
              authorDisplayName={props.authorDisplayName}
            />
          </Entity.Slot>
        )}
      </Show>

      <Show
        when={
          props.referenceProperties ||
          props.scheduleStatus ||
          (!props.hasNotifications &&
            !(isChannelEntity(props.entity) && isSearchEntity(props.entity)))
        }
      >
        <Entity.Slot
          placement="timestamp"
          class="flex items-center justify-end gap-1 text-xs text-right text-ink-extra-muted font-light"
        >
          {props.referenceProperties}
          {props.scheduleStatus}
          <Show when={!props.hasNotifications}>
            <RowEnd actions={props.actions} leadingAction={props.leadingAction}>
              <Show
                when={!isTaskEntity(props.entity)}
                fallback={
                  <Entity.Properties
                    entity={props.entity}
                    maxUserStackUsers={1}
                    showCaret={false}
                    includeProject={props.showProject}
                    hideStatus
                    hidePriority
                  />
                }
              >
                <Entity.Timestamp entity={props.entity} />
              </Show>
            </RowEnd>
          </Show>
        </Entity.Slot>
      </Show>
    </Entity.Layout>
  );
}

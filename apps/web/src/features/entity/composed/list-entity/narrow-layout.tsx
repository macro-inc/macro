import { cn } from '@ui';
import { Show } from 'solid-js';
import { Entity } from '../../entity';
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
import { GithubAuthorBadge } from './foreign';
import { RowEnd } from './row-end';
import { SOUP_ROW_CLASS } from './row-geometry';
import { type LayoutProps, RowIndicator } from './shared';

export function NarrowLayout(props: LayoutProps) {
  const reviewWithAuthor = () => {
    const entity = props.entity;
    if (!isGithubPrEntity(entity)) return;
    if (!entity.metadata.authorLogin && !entity.metadata.authorId) return;
    return entity;
  };
  return (
    <Entity.Layout
      class={cn(
        SOUP_ROW_CLASS.narrow,
        'w-full gap-x-(--soup-row-column-gap) items-center text-sm pr-2 pl-(--soup-row-padding-l) grid'
      )}
      style={{
        'grid-template-columns':
          'var(--soup-row-indicator-width) 1fr max-content',
        'grid-template-rows': '44px',
        'grid-template-areas': '"indicator title timestamp"',
      }}
    >
      <Entity.Slot placement="indicator" class="relative">
        <RowIndicator
          checked={props.checked}
          hideCheckbox={props.hideCheckbox}
          onChecked={props.onChecked}
          unread={props.unread}
        />
      </Entity.Slot>

      <Entity.Slot
        placement="title"
        class="ph-no-capture flex items-center gap-2 truncate font-semibold"
      >
        <div class="size-4 shrink-0">
          <Entity.Icon entity={props.entity} streamState={props.streamState} />
        </div>
        <Show
          when={isChannelMessageEntity(props.entity) && props.entity}
          fallback={<Entity.Title entity={props.entity} />}
        >
          {(entity) => <ChannelMessageSingleLine entity={entity()} />}
        </Show>
        <Show when={reviewWithAuthor()}>
          {(review) => (
            <span class="max-w-32 shrink-0 overflow-hidden text-xs font-normal text-ink-muted">
              <GithubAuthorBadge
                entity={review()}
                displayName={props.authorDisplayName}
              />
            </span>
          )}
        </Show>
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

      <Show
        when={
          !props.hasNotifications &&
          !(isChannelEntity(props.entity) && isSearchEntity(props.entity))
        }
      >
        <Entity.Slot
          placement="timestamp"
          class="text-xs text-right text-ink-extra-muted font-light"
        >
          <RowEnd actions={props.actions} leadingAction={props.leadingAction}>
            <Show
              when={!isTaskEntity(props.entity)}
              fallback={
                <Entity.Properties
                  entity={props.entity}
                  maxUserStackUsers={0}
                  showCaret={false}
                />
              }
            >
              <Entity.Timestamp entity={props.entity} />
            </Show>
          </RowEnd>
        </Entity.Slot>
      </Show>
    </Entity.Layout>
  );
}

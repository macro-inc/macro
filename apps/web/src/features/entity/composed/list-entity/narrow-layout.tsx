import { cn } from '@ui';
import { Show } from 'solid-js';
import { Entity } from '../../entity';
import {
  isChannelEntity,
  isChannelMessageEntity,
  isEmailEntity,
  isTaskEntity,
} from '../../types/entity';
import { isSearchEntity } from '../../types/search';
import {
  ChannelActiveCallBadge,
  ChannelJoinButton,
  ChannelMessageSingleLine,
} from './channel';
import { EmailInboxChip } from './email';
import { type LayoutProps, RowIndicator } from './shared';

export function NarrowLayout(props: LayoutProps) {
  return (
    <Entity.Layout
      class={cn(
        'w-full gap-x-1 items-center text-sm grid',
        props.indicatorPosition === 'end' ? 'px-3' : 'pr-2 pl-1'
      )}
      style={{
        'grid-template-columns':
          props.indicatorPosition === 'end'
            ? '1fr max-content auto'
            : 'auto 1fr max-content',
        'grid-template-rows': props.compact ? '38px' : '44px',
        'grid-template-areas':
          props.indicatorPosition === 'end'
            ? '"title timestamp indicator"'
            : '"indicator title timestamp"',
      }}
    >
      <Entity.Slot placement="indicator" class="relative">
        <RowIndicator
          checked={props.checked}
          hideCheckbox={props.hideCheckbox}
          onChecked={props.onChecked}
          unread={props.unreadIndicator !== 'icon' && props.unread}
        />
      </Entity.Slot>

      <Entity.Slot
        placement="title"
        class="ph-no-capture flex items-center gap-2 truncate font-semibold"
      >
        <div
          class={cn(
            'size-4 shrink-0',
            props.hideIconWhenRead && !props.unread && 'invisible'
          )}
        >
          <Entity.Icon
            entity={props.entity}
            streamState={props.streamState}
            opened={props.unreadIndicator === 'icon' && props.unread}
          />
        </div>
        <Show
          when={isChannelMessageEntity(props.entity) && props.entity}
          fallback={<Entity.Title entity={props.entity} />}
        >
          {(entity) => <ChannelMessageSingleLine entity={entity()} />}
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
          class={cn(
            'text-xs text-right text-ink-extra-muted font-light transition-opacity',
            props.showTimestampOnHover &&
              'opacity-0 group-hover/narrow:opacity-100'
          )}
        >
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
        </Entity.Slot>
      </Show>
    </Entity.Layout>
  );
}

import { Match, Show, Switch } from 'solid-js';
import { Entity } from '../../entity';
import {
  isChannelEntity,
  isChannelMessageEntity,
  isEmailEntity,
  isTaskEntity,
} from '../../types/entity';
import { isSearchEntity } from '../../types/search';
import { CalendarEventWhen } from './calendar';
import {
  ChannelActiveCallBadge,
  ChannelJoinButton,
  ChannelMessageSingleLine,
} from './channel';
import { EmailIdentity, EmailInboxChip } from './email';
import { type LayoutProps, RowIndicator } from './shared';

/**
 * One-line row for mixed-type lists (the Search / "All" view): every entity
 * renders as a single 44px line at the documents list's density — leading
 * entity icon, then a type-specific summary, then the timestamp.
 *
 * - Email: participants (bold) then the subject, with the inbox chip.
 * - Channel message: channel name, sender, then the message text.
 * - Task: title, with its properties in the trailing slot.
 * - Everything else (documents, channels, chats, calls, folders, …): title.
 */
export function NarrowSingleLineLayout(props: LayoutProps) {
  return (
    <Entity.Layout
      class="w-full gap-x-1 items-center text-sm pr-2 pl-1 grid"
      style={{
        'grid-template-columns': 'auto 1fr max-content',
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
        class="ph-no-capture flex min-w-0 items-center gap-2 truncate"
      >
        <div class="size-4 shrink-0">
          <Entity.Icon entity={props.entity} streamState={props.streamState} />
        </div>
        <Switch>
          <Match when={isEmailEntity(props.entity) && props.entity}>
            {(entity) => (
              <>
                <span class="flex max-w-1/2 min-w-0 shrink-0 items-center gap-2 font-semibold">
                  <EmailIdentity entity={entity()} />
                </span>
                <span class="min-w-0 truncate font-normal text-ink/70">
                  <Entity.Title entity={entity()} />
                </span>
                <EmailInboxChip entity={entity()} class="ml-auto" />
              </>
            )}
          </Match>
          <Match when={isChannelMessageEntity(props.entity) && props.entity}>
            {(entity) => <ChannelMessageSingleLine entity={entity()} />}
          </Match>
          <Match when={true}>
            <span class="min-w-0 truncate font-semibold">
              <Entity.Title entity={props.entity} />
            </span>
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
          </Match>
        </Switch>
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
          <Switch fallback={<Entity.Timestamp entity={props.entity} />}>
            <Match when={isTaskEntity(props.entity)}>
              <Entity.Properties
                entity={props.entity}
                maxUserStackUsers={0}
                showCaret={false}
              />
            </Match>
            <Match
              when={props.entity.type === 'calendar_event' && props.entity}
            >
              {(entity) => <CalendarEventWhen entity={entity()} />}
            </Match>
          </Switch>
        </Entity.Slot>
      </Show>
    </Entity.Layout>
  );
}

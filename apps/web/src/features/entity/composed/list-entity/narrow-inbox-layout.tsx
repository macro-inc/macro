import { cn } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import { MultiSelectCheckbox } from '../../components/MultiSelectCheckbox';
import { UnreadIndicator } from '../../components/UnreadIndicator';
import { Entity } from '../../entity';
import {
  isCallEntity,
  isChannelEntity,
  isChannelMessageEntity,
  isEmailEntity,
  isTaskEntity,
} from '../../types/entity';
import { isWithNotification } from '../../types/notification';
import { isSearchEntity } from '../../types/search';
import {
  filterNotDoneNotifications,
  filterValidNotifications,
} from '../../utils/notification';
import { CallNarrowBody } from './call';
import {
  ChannelLatestMessageNarrowBody,
  ChannelMessageNarrowBody,
} from './channel';
import { EmailIdentity, EmailInboxChip, EmailNarrowBody } from './email';
import { classicWeight, InboxDivider, type LayoutProps } from './shared';
import { TaskNarrowBody } from './task';

export function NarrowInboxLayout(props: LayoutProps) {
  const isDirectMessage = () =>
    isChannelEntity(props.entity) &&
    props.entity.channelType === 'direct_message';

  const firstNotification = () => {
    if (!isWithNotification(props.entity)) return undefined;
    return filterNotDoneNotifications(
      filterValidNotifications(props.entity.notifications?.())
    )[0];
  };

  return (
    <Entity.Layout
      class="w-full text-sm grid"
      style={{
        // A scheduled send's badge is wider than a date, so it sizes its column.
        'grid-template-columns':
          props.leadingAction ||
          props.referenceProperties ||
          props.scheduleStatus ||
          (isEmailEntity(props.entity) && props.entity.scheduledSendTime)
            ? 'auto 1fr auto'
            : 'auto 1fr 8ch',
        'grid-template-rows': 'auto auto auto',
        'grid-template-areas':
          '"icon title timestamp" "icon body body" "icon body body"',
      }}
    >
      <Entity.Slot
        placement="icon"
        class="flex items-center self-center pr-(--soup-inbox-icon-padding-r)"
      >
        <Show
          when={props.classic && !props.hideCheckbox}
          fallback={
            <UnreadIndicator
              class="mx-(--soup-inbox-unread-indicator-padding-x) size-(--soup-inbox-unread-indicator-diameter)"
              active={props.unread && !props.classic}
            />
          }
        >
          {/* Classic keeps the checkbox in the unread dot's column, beside the
              sender's picture, so selecting never covers who it's from. */}
          <div class="h-(--soup-inbox-icon-diameter) w-(--soup-inbox-unread) shrink-0">
            <MultiSelectCheckbox
              checked={props.checked}
              onChecked={props.onChecked}
              showBorder
            />
          </div>
        </Show>
        <div class="relative size-(--soup-inbox-icon-diameter) shrink-0 group">
          <Show when={props.hideCheckbox || props.classic || !props.checked}>
            <div
              class={cn(
                'absolute inset-0 grid place-items-center transition-opacity',
                {
                  'group-hover:opacity-0':
                    !props.hideCheckbox && !props.classic,
                }
              )}
            >
              <Show
                when={isDirectMessage()}
                fallback={
                  <div class="size-(--soup-inbox-icon-diameter) bg-edge-muted rounded-full flex items-center justify-center">
                    <div class="size-[calc(var(--soup-inbox-icon-diameter)*var(--soup-inbox-icon-factor))]">
                      <Entity.Icon
                        entity={props.entity}
                        streamState={props.streamState}
                      />
                    </div>
                  </div>
                }
              >
                <div class="size-11">
                  <Entity.Icon
                    entity={props.entity}
                    streamState={props.streamState}
                    class="bg-edge-muted text-ink"
                  />
                </div>
              </Show>
            </div>
          </Show>
          <Show when={!props.hideCheckbox && !props.classic}>
            {/* TODO: make multiselect work on mobile */}
            <div
              class={cn(
                'absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity',
                { 'opacity-100': props.checked }
              )}
            >
              <MultiSelectCheckbox
                checked={props.checked}
                onChecked={props.onChecked}
              />
            </div>
          </Show>
        </div>
      </Entity.Slot>

      <Entity.Slot
        placement="title"
        class={cn(
          'ph-no-capture flex items-center gap-2 truncate pt-3',
          props.classic ? classicWeight(props.unread) : 'font-semibold'
        )}
      >
        <Show
          when={isEmailEntity(props.entity) && props.entity}
          fallback={<Entity.Title entity={props.entity} />}
        >
          {(entity) => (
            <>
              <EmailIdentity entity={entity()} />
              <EmailInboxChip entity={entity()} class="ml-auto" />
            </>
          )}
        </Show>
      </Entity.Slot>

      <Entity.Slot
        placement="timestamp"
        class={cn(
          'flex items-center justify-end gap-1 text-xs text-right pt-3 pr-4',
          props.classic ? classicWeight(props.unread) : 'font-light',
          // A Classic unread date reads like its sender and subject.
          props.classic && props.unread ? 'text-ink' : 'text-ink-extra-muted'
        )}
      >
        {props.leadingAction}
        {props.referenceProperties}
        {props.scheduleStatus}
        <Show
          when={
            !props.hasNotifications &&
            !(isChannelEntity(props.entity) && isSearchEntity(props.entity))
          }
        >
          <Entity.Timestamp entity={props.entity} />
        </Show>
      </Entity.Slot>

      <Switch>
        <Match when={isChannelMessageEntity(props.entity) && props.entity}>
          {(entity) => <ChannelMessageNarrowBody entity={entity()} />}
        </Match>
        <Match
          when={isChannelEntity(props.entity) && props.entity.latestMessage}
        >
          {(msg) => <ChannelLatestMessageNarrowBody message={msg()} />}
        </Match>
        <Match when={isEmailEntity(props.entity) && props.entity}>
          {(entity) => (
            <EmailNarrowBody
              entity={entity()}
              chars={props.chars}
              showHitSnippet={props.showHitSnippet}
              setContainerRef={props.setSnippetContainerRef}
              previewLeading={props.previewLeading}
              subjectClass={
                props.classic ? classicWeight(props.unread) : undefined
              }
            />
          )}
        </Match>
        <Match when={isTaskEntity(props.entity)}>
          <TaskNarrowBody
            entity={props.entity}
            notification={firstNotification()}
          />
        </Match>
        <Match when={isCallEntity(props.entity) && props.entity}>
          {(entity) => (
            <CallNarrowBody
              entity={entity()}
              showAttendanceBadge={props.showCalendarAttendance !== false}
              setContainerRef={props.setSnippetContainerRef}
              chars={props.chars}
            />
          )}
        </Match>
        <Match when={true}>
          <Entity.Slot placement="body" class="pb-2 min-h-[2lh] pr-4" />
        </Match>
      </Switch>
      {/* Classic rows draw their wall-to-wall line over this pixel. */}
      <InboxDivider hidden={props.classic} />
    </Entity.Layout>
  );
}

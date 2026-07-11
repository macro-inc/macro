import { useMaybeSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { tryMacroId, useDisplayNameParts } from '@core/user';
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
import { InboxDivider, type LayoutProps } from './shared';
import { TaskNarrowBody } from './task';

export function NarrowInboxLayout(props: LayoutProps) {
  const soupView = useMaybeSoupView();
  const isDirectMessage = () =>
    isChannelEntity(props.entity) &&
    props.entity.channelType === 'direct_message';

  const mostRecentMessageSenderName = () =>
    isChannelEntity(props.entity) && props.entity.latestMessage?.senderId
      ? useDisplayNameParts(tryMacroId(props.entity.latestMessage?.senderId))
      : undefined;

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
        'grid-template-columns': 'auto 1fr 8ch',
        'grid-template-rows': 'auto auto auto',
        'grid-template-areas':
          '"icon title timestamp" "icon body body" "icon body body"',
      }}
    >
      <Entity.Slot
        placement="icon"
        class="flex items-center self-center pr-(--soup-inbox-icon-padding-r)"
      >
        <UnreadIndicator
          class="mx-(--soup-inbox-unread-indicator-padding-x) size-(--soup-inbox-unread-indicator-diameter)"
          active={props.unread}
        />
        <div class="relative size-(--soup-inbox-icon-diameter) shrink-0 group">
          <Show when={!props.checked}>
            <div class="absolute inset-0 grid place-items-center group-hover:opacity-0 transition-opacity">
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
        </div>
      </Entity.Slot>

      <Entity.Slot
        placement="title"
        class="ph-no-capture flex items-center gap-2 truncate font-semibold pt-3"
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
        class="text-xs text-right text-ink-extra-muted font-light pt-3 pr-4"
      >
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
          {(msg) => (
            <ChannelLatestMessageNarrowBody
              message={msg()}
              senderFirstName={mostRecentMessageSenderName()?.firstName()}
            />
          )}
        </Match>
        <Match when={isEmailEntity(props.entity) && props.entity}>
          {(entity) => (
            <EmailNarrowBody
              entity={entity()}
              chars={props.chars}
              showHitSnippet={props.showHitSnippet}
              setContainerRef={props.setSnippetContainerRef}
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
              showAttendanceBadge={(soupView?.activeTab() ?? 'all') === 'all'}
              setContainerRef={props.setSnippetContainerRef}
              chars={props.chars}
            />
          )}
        </Match>
        <Match when={true}>
          <Entity.Slot placement="body" class="pb-2 min-h-[2lh] pr-4" />
        </Match>
      </Switch>
      <InboxDivider />
    </Entity.Layout>
  );
}

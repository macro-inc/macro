import { useMaybeSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { formatCallDuration } from '@block-call/utils';
import { EntityRowTags } from '@property/tags';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { cn } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import {
  CallDurationBadge,
  CallStatusBadge,
  SharedBadge,
} from '../../components/Badges';
import { MultiSelectCheckbox } from '../../components/MultiSelectCheckbox';
import { ProjectBreadCrumb } from '../../components/ProjectBreadCrumb';
import { UnreadIndicator } from '../../components/UnreadIndicator';
import { Entity } from '../../entity';
import {
  isAutomationEntity,
  isCallEntity,
  isChannelEntity,
  isChannelMessageEntity,
  isChatEntity,
  isDocumentEntity,
  isEmailEntity,
  isGithubPrEntity,
  isProjectContainedEntity,
  isProjectEntity,
  isReminderEntity,
  isTaskEntity,
} from '../../types/entity';
import { isSearchEntity } from '../../types/search';
import { AutomationWideContent } from './automation';
import { CalendarStamp, CalendarWideContent } from './calendar';
import { CallParticipants, CallWideContent } from './call';
import {
  ChannelActiveCallBadge,
  ChannelJoinButton,
  ChannelMessageWideContent,
  ChannelWideContent,
} from './channel';
import { EmailWideContent, useOwningInboxForEntity } from './email';
import {
  GithubPullRequestChecksIndicator,
  GithubPullRequestPills,
} from './foreign';
import { ReminderWideContent } from './reminder';
import type { LayoutProps } from './shared';

function RowTags(props: {
  entityId: string;
  entityType: EntityType;
  properties: SoupProperty[] | undefined;
  onFilterByTag?: (optionId: string) => void;
}) {
  return (
    <EntityRowTags
      entityId={props.entityId}
      entityType={props.entityType}
      properties={props.properties}
      onFilterByTag={props.onFilterByTag}
    />
  );
}

export function WideLayout(props: LayoutProps) {
  const soupView = useMaybeSoupView();
  // When a thread resolves to one of the user's inboxes the inbox chip already
  // conveys ownership, so the generic "shared" badge would be redundant.
  const owningInbox = useOwningInboxForEntity(() => props.entity);

  return (
    <Entity.Layout
      class={cn(
        'w-full min-h-[inherit] items-center text-sm px-2',
        'gap-2 grid grid-rows-[1fr]',
        // Drop the indicator column entirely when the checkbox is hidden so the
        // content isn't indented by an empty 1rem gutter.
        props.hideCheckbox
          ? 'grid-cols-[1fr_auto_8ch]'
          : 'grid-cols-[1rem_1fr_auto_8ch]',
        '[--title-width:10rem]'
      )}
      style={{
        'grid-template-areas': props.hideCheckbox
          ? '"content meta timestamp"'
          : '"indicator content meta timestamp"',
      }}
    >
      <Show when={!props.hideCheckbox}>
        <Entity.Slot placement="indicator" class="relative size-full group">
          <div class="absolute inset-0 grid place-items-center group-hover:opacity-0">
            <UnreadIndicator active={props.unread} />
          </div>
          <div
            class={cn(
              'absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100',
              {
                'opacity-100': props.checked,
              }
            )}
          >
            <MultiSelectCheckbox
              checked={props.checked}
              onChecked={props.onChecked}
            />
          </div>
        </Entity.Slot>
      </Show>
      <Entity.Slot
        placement="content"
        class="ph-no-capture font-medium truncate items-center gap-2 flex"
      >
        <div class="size-4 shrink-0">
          <Entity.Icon entity={props.entity} streamState={props.streamState} />
        </div>
        <Switch>
          <Match when={isEmailEntity(props.entity) && props.entity}>
            {(entity) => (
              <EmailWideContent
                entity={entity()}
                chars={props.chars}
                showHitSnippet={props.showHitSnippet}
                setContainerRef={props.setSnippetContainerRef}
              />
            )}
          </Match>
          <Match when={isChannelMessageEntity(props.entity) && props.entity}>
            {(entity) => <ChannelMessageWideContent entity={entity()} />}
          </Match>
          <Match when={isChannelEntity(props.entity) && props.entity}>
            {(entity) => (
              <ChannelWideContent
                entity={entity()}
                showLatestMessage={!props.hasNotifications}
              />
            )}
          </Match>
          <Match when={isCallEntity(props.entity) && props.entity}>
            {(entity) => (
              <CallWideContent
                entity={entity()}
                setContainerRef={props.setSnippetContainerRef}
                chars={props.chars}
              />
            )}
          </Match>
          <Match when={isAutomationEntity(props.entity) && props.entity}>
            {(entity) => <AutomationWideContent entity={entity()} />}
          </Match>
          <Match when={isReminderEntity(props.entity) && props.entity}>
            {(entity) => <ReminderWideContent entity={entity()} />}
          </Match>
          <Match when={props.entity.type === 'calendar_event' && props.entity}>
            {(entity) => <CalendarWideContent entity={entity()} />}
          </Match>
          <Match when={isGithubPrEntity(props.entity) && props.entity}>
            {(entity) => (
              <span class="flex min-w-0 items-center gap-1">
                <span class="min-w-0 truncate">
                  <Entity.Title entity={entity()} />
                </span>
                <GithubPullRequestChecksIndicator entity={entity()} />
              </span>
            )}
          </Match>
          <Match when={props.entity}>
            {(entity) => <Entity.Title entity={entity()} />}
          </Match>
        </Switch>
      </Entity.Slot>
      <Entity.Slot placement="meta" class="flex items-center gap-2">
        <Show when={isProjectEntity(props.entity) && props.entity}>
          {(entity) => (
            <RowTags
              entityId={entity().id}
              entityType={EntityType.PROJECT}
              properties={entity().properties}
              onFilterByTag={soupView?.filterByTag}
            />
          )}
        </Show>
        <Show when={isDocumentEntity(props.entity) && props.entity}>
          {(entity) => {
            const properties = () => {
              const doc = entity();
              return 'properties' in doc ? doc.properties : undefined;
            };
            return (
              <RowTags
                entityId={entity().id}
                entityType={
                  isTaskEntity(entity()) ? EntityType.TASK : EntityType.DOCUMENT
                }
                properties={properties()}
                onFilterByTag={soupView?.filterByTag}
              />
            );
          }}
        </Show>
        <Show when={isEmailEntity(props.entity) && props.entity}>
          {(entity) => (
            <RowTags
              entityId={entity().id}
              entityType={EntityType.THREAD}
              properties={entity().properties}
              onFilterByTag={soupView?.filterByTag}
            />
          )}
        </Show>
        <Show when={isChatEntity(props.entity) && props.entity}>
          {(entity) => (
            <RowTags
              entityId={entity().id}
              entityType={EntityType.CHAT}
              properties={entity().properties}
              onFilterByTag={soupView?.filterByTag}
            />
          )}
        </Show>
        <Show when={isCallEntity(props.entity) && props.entity}>
          {(entity) => (
            <RowTags
              entityId={entity().id}
              entityType={EntityType.CALL_RECORD}
              properties={entity().properties}
              onFilterByTag={soupView?.filterByTag}
            />
          )}
        </Show>
        <Show
          when={
            props.isShared && !owningInbox() && !isGithubPrEntity(props.entity)
          }
        >
          <SharedBadge ownerId={props.entity.ownerId} />
        </Show>
        <Show when={isGithubPrEntity(props.entity) && props.entity}>
          {(entity) => <GithubPullRequestPills entity={entity()} />}
        </Show>
        <Show when={isCallEntity(props.entity) && props.entity}>
          {(entity) => (
            <>
              <Show when={(soupView?.activeTab() ?? 'all') === 'all'}>
                <CallStatusBadge status={entity().status} />
              </Show>
              <Show
                when={entity().durationMs}
                fallback={
                  <Show when={entity().isActive}>
                    <CallDurationBadge duration="In progress" />
                  </Show>
                }
              >
                {(durationMs) => (
                  <CallDurationBadge
                    duration={formatCallDuration(durationMs())}
                  />
                )}
              </Show>
              <span class="flex w-10 shrink-0 justify-end">
                <CallParticipants participantIds={entity().participantIds} />
              </span>
            </>
          )}
        </Show>
        <Show when={isTaskEntity(props.entity) && props.entity}>
          {(entity) => <Entity.Properties entity={entity()} />}
        </Show>
        <Show when={isProjectContainedEntity(props.entity) && props.entity}>
          {(entity) => (
            <span class="ph-no-capture text-ink-extra-muted text-xs">
              <ProjectBreadCrumb
                entity={entity()}
                onClick={props.onProjectClick}
              />
            </span>
          )}
        </Show>
        <Show when={isChannelEntity(props.entity) && props.entity}>
          {(entity) => <ChannelActiveCallBadge channelId={entity().id} />}
        </Show>
        <Show
          when={
            isChannelEntity(props.entity) &&
            props.entity.isParticipant === false &&
            props.entity
          }
        >
          {(entity) => <ChannelJoinButton entity={entity()} />}
        </Show>
      </Entity.Slot>
      <Entity.Slot
        placement="timestamp"
        class="text-xs text-right text-ink-extra-muted font-medium"
      >
        <Show
          when={
            !props.hasNotifications &&
            !(isChannelEntity(props.entity) && isSearchEntity(props.entity))
          }
        >
          <Switch fallback={<Entity.Timestamp entity={props.entity} />}>
            {/* The event's own date, not its sync time. */}
            <Match
              when={props.entity.type === 'calendar_event' && props.entity}
            >
              {(entity) => <CalendarStamp entity={entity()} />}
            </Match>
          </Switch>
        </Show>
      </Entity.Slot>
    </Entity.Layout>
  );
}

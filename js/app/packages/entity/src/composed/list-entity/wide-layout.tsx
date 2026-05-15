import { useMaybeSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { CallAgainButton } from '@channel/Call/CallAgainButton';
import { cn } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import { AttendanceBadge, SharedBadge } from '../../components/Badges';
import { MultiSelectCheckbox } from '../../components/MultiSelectCheckbox';
import { ProjectBreadCrumb } from '../../components/ProjectBreadCrumb';
import { UnreadIndicator } from '../../components/UnreadIndicator';
import { Entity } from '../../entity';
import {
  isAutomationEntity,
  isCallEntity,
  isChannelEntity,
  isChannelMessageEntity,
  isEmailEntity,
  isProjectContainedEntity,
  isTaskEntity,
} from '../../types/entity';
import { isSearchEntity } from '../../types/search';
import { AutomationWideContent } from './automation';
import { CallParticipants, CallWideContent } from './call';
import { ChannelMessageWideContent, ChannelWideContent } from './channel';
import { EmailWideContent } from './email';
import type { LayoutProps } from './shared';

export function WideLayout(props: LayoutProps) {
  const soupView = useMaybeSoupView();

  return (
    <Entity.Layout
      class={cn(
        'w-full min-h-[inherit] items-center text-sm px-2',
        'gap-2 grid grid-cols-[1rem_1fr_auto_8ch] grid-rows-[1fr]',
        '[--title-width:10rem]'
      )}
      style={{
        'grid-template-areas': '"indicator content meta timestamp"',
      }}
    >
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
      <Entity.Slot
        placement="content"
        class="ph-no-capture font-semibold truncate items-center gap-2 flex"
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
          <Match when={props.entity}>
            {(entity) => <Entity.Title entity={entity()} />}
          </Match>
        </Switch>
      </Entity.Slot>
      <Entity.Slot placement="meta" class="flex items-center gap-2">
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
        <Show when={props.isShared}>
          <SharedBadge ownerId={props.entity.ownerId} />
        </Show>
        <Show when={isCallEntity(props.entity) && props.entity}>
          {(entity) => (
            <>
              <span class="flex w-24 shrink-0 justify-end">
                <Show when={!entity().isActive}>
                  <CallAgainButton
                    channelId={entity().channelId}
                    class="opacity-0 group-hover/narrow:opacity-100 transition-opacity flex shrink-0 items-center gap-1 rounded-xs border border-edge-muted px-1.5 py-1 text-xs font-medium text-ink-muted hover:bg-hover hover:text-ink focus-visible:outline-none"
                  />
                </Show>
              </span>
              <Show when={(soupView?.activeTab() ?? 'all') === 'all'}>
                <AttendanceBadge attended={entity().attended} />
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
          <Entity.Timestamp entity={props.entity} />
        </Show>
      </Entity.Slot>
    </Entity.Layout>
  );
}

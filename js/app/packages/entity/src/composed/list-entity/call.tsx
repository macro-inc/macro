import { formatCallDuration } from '@block-call/utils';
import { UserGroup } from '@core/component/Properties/component/propertyValue/UserGroup';
import { usePropertyEntityDisplay } from '@core/component/Properties/hooks';
import type { EntityReference } from '@core/component/Properties/types';
import { Tooltip } from '@core/component/Tooltip';
import { UserIcon } from '@core/component/UserIcon';
import { matches } from '@core/util/match';
import UserCircleIcon from '@icon/regular/user-circle.svg';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { For, Show } from 'solid-js';
import { AttendanceBadge } from '../../components/Badges';
import { CallRecordName } from '../../components/CallRecordName';
import { Entity } from '../../entity';
import { HitSnippet } from '../../extractors-search/HitSnippet';
import { SearchSender } from '../../extractors-search/search-sender';
import type { CallEntity } from '../../types/entity';
import { isCallRecordHit } from '../../types/search';
import { firstContentHit } from './shared';

function ParticipantItem(props: { userId: string }) {
  const { name } = usePropertyEntityDisplay(
    () => props.userId,
    () => EntityType.USER,
    { fallbackIcon: null }
  );
  return (
    <div class="inline-flex items-center gap-1.5 px-2 py-1 text-xs leading-none text-ink-muted border border-edge-muted size-fit">
      <div class="size-4 rounded-full overflow-hidden shrink-0">
        <UserIcon id={props.userId} isDeleted={false} size="fill" />
      </div>
      <span class="truncate max-w-37.5">{name()}</span>
    </div>
  );
}

function ParticipantsTooltip(props: { participantIds: string[] }) {
  return (
    <div class="p-2 border border-edge-muted bg-panel min-w-48 max-w-72">
      <div class="flex items-center gap-2 text-ink-muted border-b border-edge-muted/50 pb-1.5 mb-1.5">
        <UserCircleIcon class="size-3.5 text-ink-muted" />
        <span class="text-xs">Participants</span>
      </div>
      <div class="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
        <For each={props.participantIds}>
          {(userId) => <ParticipantItem userId={userId} />}
        </For>
      </div>
    </div>
  );
}

export function CallParticipants(props: { participantIds: string[] }) {
  const entities = (): EntityReference[] =>
    props.participantIds.map((id) => ({
      entity_id: id,
      entity_type: EntityType.USER,
    }));
  return (
    <Show when={props.participantIds.length > 0}>
      <Tooltip
        unstyled
        tooltip={<ParticipantsTooltip participantIds={props.participantIds} />}
        class="flex items-center"
      >
        <UserGroup entities={entities()} maxUsers={2} />
      </Tooltip>
    </Show>
  );
}

export function CallNarrowBody(props: {
  entity: CallEntity;
  showAttendanceBadge: boolean;
  setContainerRef: (el: HTMLElement) => void;
  chars: number;
}) {
  const hit = () => firstContentHit(props.entity);
  return (
    <Entity.Slot placement="body" class="flex flex-col pb-2 min-h-[2lh] pr-4">
      <Show
        when={hit()}
        fallback={
          <span class="text-ink-muted text-xs truncate">
            <CallRecordName entity={props.entity} />
          </span>
        }
      >
        {(h) => (
          <span class="flex items-center gap-1 min-w-0 truncate">
            <Show when={matches(h(), isCallRecordHit)}>
              {(callHit) => (
                <Show when={callHit().senderId}>
                  {(id) => <UserIcon id={id()} size="sm" />}
                </Show>
              )}
            </Show>
            <span class="shrink-0 text-ink-extra-muted text-xs whitespace-nowrap">
              <SearchSender hit={h()} />
            </span>
            <span
              ref={props.setContainerRef}
              class="text-ink/50 font-normal truncate min-w-0 text-xs"
            >
              <HitSnippet content={h().content} chars={props.chars} />
            </span>
          </span>
        )}
      </Show>
      <span class="text-ink-extra-muted text-xs flex items-center gap-2">
        <Show
          when={props.entity.durationMs}
          fallback={props.entity.isActive ? 'In progress' : 'No duration'}
        >
          {(ms) => formatCallDuration(ms())}
        </Show>
        <Show when={props.showAttendanceBadge}>
          <AttendanceBadge attended={props.entity.attended} />
        </Show>
      </span>
      <Show when={!hit() && props.entity.summary}>
        {(summary) => (
          <span class="text-ink/50 font-normal truncate text-xs">
            {summary()}
          </span>
        )}
      </Show>
    </Entity.Slot>
  );
}

export function CallWideContent(props: {
  entity: CallEntity;
  setContainerRef: (el: HTMLElement) => void;
  chars: number;
}) {
  const hit = () => firstContentHit(props.entity);
  return (
    <>
      <span class="truncate">
        <CallRecordName entity={props.entity} />
      </span>
      <Show
        when={hit()}
        fallback={
          <>
            <span class="text-ink-extra-muted font-medium truncate shrink-0">
              <Show
                when={props.entity.durationMs}
                fallback={props.entity.isActive ? 'In progress' : ''}
              >
                {(ms) => formatCallDuration(ms())}
              </Show>
            </span>
            <Show when={props.entity.summary}>
              {(summary) => (
                <span class="text-ink/50 font-medium truncate flex-1 min-w-0">
                  {summary()}
                </span>
              )}
            </Show>
          </>
        }
      >
        {(h) => (
          <>
            <span class="shrink-0 flex gap-1.5 items-center">
              <Show when={matches(h(), isCallRecordHit)}>
                {(callHit) => (
                  <Show when={callHit().senderId}>
                    {(id) => <UserIcon id={id()} size="sm" />}
                  </Show>
                )}
              </Show>
              <span class="text-ink-extra-muted text-xs whitespace-nowrap">
                <SearchSender hit={h()} />
              </span>
            </span>
            <div
              ref={props.setContainerRef}
              class="text-ink/50 font-medium flex-1 min-w-0 truncate"
            >
              <HitSnippet content={h().content} chars={props.chars} />
            </div>
          </>
        )}
      </Show>
    </>
  );
}

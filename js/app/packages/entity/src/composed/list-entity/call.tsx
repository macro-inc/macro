import { Show } from 'solid-js';
import { UserIcon } from '@core/component/UserIcon';
import { matches } from '@core/util/match';
import { formatCallDuration } from '@block-call/utils';
import { AttendanceBadge } from '../../components/Badges';
import { CallChannelName } from '../../components/CallChannelName';
import { Entity } from '../../entity';
import { HitSnippet } from '../../extractors-search/HitSnippet';
import { SearchSender } from '../../extractors-search/search-sender';
import type { CallEntity } from '../../types/entity';
import { isCallRecordHit } from '../../types/search';
import { firstContentHit } from './shared';

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
            <CallChannelName entity={props.entity} />
          </span>
        }
      >
        {(h) => (
          <span class="flex items-center gap-1 min-w-0 truncate">
            <Show when={matches(h(), isCallRecordHit)}>
              {(callHit) => (
                <Show when={callHit().senderId}>
                  {(id) => <UserIcon id={id()} size="xs" />}
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
        <CallChannelName entity={props.entity} />
      </span>
      <Show
        when={hit()}
        fallback={
          <span class="text-ink-extra-muted font-medium truncate">
            <Show
              when={props.entity.durationMs}
              fallback={props.entity.isActive ? 'In progress' : ''}
            >
              {(ms) => formatCallDuration(ms())}
            </Show>
          </span>
        }
      >
        {(h) => (
          <>
            <span class="shrink-0 flex gap-1.5 items-center">
              <Show when={matches(h(), isCallRecordHit)}>
                {(callHit) => (
                  <Show when={callHit().senderId}>
                    {(id) => <UserIcon id={id()} size="xs" />}
                  </Show>
                )}
              </Show>
              <span class="text-ink-extra-muted text-xs whitespace-nowrap">
                <SearchSender hit={h()} />
              </span>
            </span>
            <div
              ref={props.setContainerRef}
              class="text-ink/50 font-medium flex-1 min-w-0 overflow-hidden"
            >
              <HitSnippet content={h().content} chars={props.chars} />
            </div>
          </>
        )}
      </Show>
    </>
  );
}

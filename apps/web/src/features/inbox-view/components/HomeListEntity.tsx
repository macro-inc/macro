import { InboxListEntity } from '@app/features/next-soup/soup-view/views/inbox/InboxListEntity';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Entity, MaybeEntityRow } from '@entity';
import type { BaseListEntityProps } from '@entity/composed/list-entity/shared';
import { unreadFilterFn } from '@entity/utils/filter';
import { cn, pressHandlers } from '@ui';
import { Show } from 'solid-js';
import { HomeEntityIcon } from './HomeEntityIcon';

type HomeListEntityProps = BaseListEntityProps & {
  occurrenceKey: string;
  channelName?: string;
};

/** Keep thread context visible instead of rendering replies as channel pills. */
export function HomeListEntity(props: HomeListEntityProps) {
  return (
    <Show
      when={!isTouchDevice() && props.entity.type === 'channel_thread'}
      fallback={<CompactHomeListEntity {...props} />}
    >
      <InboxListEntity
        {...props}
        class="mx-1.5 my-0.5 min-w-0"
        cardClass="rounded-xl px-2.5 py-2"
        focusable={false}
      />
    </Show>
  );
}

/** One compact, single-line Home item; the list owns focus and activation. */
function CompactHomeListEntity(props: HomeListEntityProps) {
  const unread = () => unreadFilterFn(props.entity);

  return (
    <div class="soup-list-entity relative mx-1.5 my-0.5">
      <MaybeEntityRow
        entityId={props.occurrenceKey}
        config={props.entityRowConfig}
      >
        <div
          class={cn(
            'group/home-item relative flex h-8 min-w-0 items-center gap-2 rounded-xl px-2.5 text-left text-sm outline-none touch:h-11',
            props.checked || props.highlighted
              ? 'bg-active text-ink'
              : 'text-ink-muted hover:bg-hover hover:text-ink'
          )}
          {...pressHandlers((event) => {
            event.preventDefault();
            props.onClick?.(event);
          })}
          data-home-item
        >
          <HomeEntityIcon entity={props.entity} />
          <span
            class={cn(
              'block min-w-0 flex-1 truncate font-normal',
              unread() && 'text-ink'
            )}
          >
            <Show
              when={props.channelName}
              fallback={<Entity.Title entity={props.entity} />}
            >
              {props.channelName}
            </Show>
          </span>
          <span
            data-home-timestamp
            class="hidden shrink-0 text-xs font-normal text-ink-extra-muted group-hover/home-item:block"
          >
            <Entity.Timestamp
              entity={props.entity}
              overrideTimeStamp={props.timestamp ?? undefined}
            />
          </span>
          <Show when={unread()}>
            <span
              aria-label="Unread"
              class="size-1.5 shrink-0 rounded-full bg-accent"
            />
          </Show>
        </div>
      </MaybeEntityRow>
    </div>
  );
}

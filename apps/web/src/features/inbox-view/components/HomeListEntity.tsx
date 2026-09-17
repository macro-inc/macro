import { ViewSidebar } from '@app/components/view-shell';
import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import { Entity, MaybeEntityRow } from '@entity';
import type { BaseListEntityProps } from '@entity/composed/list-entity/shared';
import { unreadFilterFn } from '@entity/utils/filter';
import ArrowBendUpLeftIcon from '@phosphor-icons/core/regular/arrow-bend-up-left.svg?component-solid';
import { getBotDisplayName } from '@queries/channel/message-sender';
import { cn, pressHandlers } from '@ui';
import { Show } from 'solid-js';
import { HomeEntityIcon } from './HomeEntityIcon';

type HomeListEntityProps = BaseListEntityProps & {
  occurrenceKey: string;
  channelName?: string;
};

/** One compact, single-line Home item; the list owns focus and activation. */
export function HomeListEntity(props: HomeListEntityProps) {
  const threadEntity = () =>
    props.entity.type === 'channel_thread' ? props.entity : undefined;
  const unread = () => unreadFilterFn(props.entity);

  return (
    <div class="soup-list-entity relative mx-(--sidebar-gutter) my-(--sidebar-row-gap)">
      <MaybeEntityRow
        entityId={props.occurrenceKey}
        config={props.entityRowConfig}
      >
        <ViewSidebar.Item
          as="div"
          class="group/home-item relative"
          active={props.checked || props.highlighted}
          {...pressHandlers((event) => {
            event.preventDefault();
            props.onClick?.(event);
          })}
          data-home-item
        >
          <Show
            when={threadEntity()}
            fallback={<HomeEntityIcon entity={props.entity} />}
          >
            <ViewSidebar.Icon>
              <ArrowBendUpLeftIcon class="size-4" />
            </ViewSidebar.Icon>
          </Show>
          <span
            class={cn(
              'block min-w-0 flex-1 truncate font-normal',
              unread() && 'text-ink'
            )}
          >
            <Show
              when={threadEntity()}
              fallback={
                <Show
                  when={props.channelName}
                  fallback={<Entity.Title entity={props.entity} />}
                >
                  {props.channelName}
                </Show>
              }
            >
              {(thread) => (
                <HomeThreadTitle
                  entity={thread()}
                  channelName={props.channelName}
                />
              )}
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
        </ViewSidebar.Item>
      </MaybeEntityRow>
    </div>
  );
}

function HomeThreadTitle(
  props: Pick<HomeListEntityProps, 'entity' | 'channelName'>
) {
  const currentUserId = useUserId();
  const sender = () => {
    const entity = props.entity;
    if (entity.type !== 'channel_thread') return undefined;
    const notification = entity.notifications?.()?.[0];
    if (
      notification?.notification_metadata?.tag === 'channel_message_reply' &&
      notification.sender_id
    ) {
      return { id: notification.sender_id };
    }
    return { id: entity.senderId, details: entity.sender };
  };
  const senderLabel = () => {
    const value = sender();
    if (!value) return 'Someone';
    if (value.id === currentUserId()) return 'You';
    return (
      getBotDisplayName(value.id, value.details) ||
      getDisplayName(tryMacroId(value.id), { emailFallback: 'local-part' }) ||
      value.details?.name ||
      'Someone'
    );
  };
  const location = () => {
    const name = props.channelName || props.entity.name;
    return props.entity.type === 'channel_thread' &&
      props.entity.channelType === 'direct_message'
      ? name
      : `#${name.replace(/^#/, '')}`;
  };
  return (
    <span class="flex min-w-0 items-center">
      <span class="max-w-1/2 truncate">{senderLabel()}</span>
      <span class="shrink-0 whitespace-pre"> in </span>
      <span class="min-w-0 truncate">{location()}</span>
    </span>
  );
}

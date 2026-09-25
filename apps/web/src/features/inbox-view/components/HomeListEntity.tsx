import { ViewSidebar } from '@app/components/view-shell';
import { AgentSessionListItem } from '@app/features/agents-view/views/AgentSessionListItem';
import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import { Entity, MaybeEntityRow } from '@entity';
import type { BaseListEntityProps } from '@entity/composed/list-entity/shared';
import { unreadFilterFn } from '@entity/utils/filter';
import { getDocumentCommentNotification } from '@notifications/document-comment-notification';
import { getNotificationAgentSender } from '@notifications/notification-sender';
import type { UnifiedNotification } from '@notifications/types';
import ArrowBendUpLeftIcon from '@phosphor-icons/core/regular/arrow-bend-up-left.svg?component-solid';
import ChatTeardropIcon from '@phosphor-icons/core/regular/chat-teardrop.svg?component-solid';
import { getBotDisplayName } from '@queries/messages/message-sender';
import { cn, pressHandlers } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { HomeEntityIcon } from './HomeEntityIcon';

type HomeListEntityProps = BaseListEntityProps & {
  occurrenceKey: string;
  channelName?: string;
};

/** One compact, single-line Home item; the list owns focus and activation. */
export function HomeListEntity(props: HomeListEntityProps) {
  const threadEntity = () =>
    props.entity.type === 'channel_thread' ? props.entity : undefined;
  // A document announcing a comment reads like a thread row: the
  // comment glyph, who did what, and where. Opening it lands on the comment.
  const commentNotification = () =>
    getDocumentCommentNotification(props.entity);
  const unread = () => unreadFilterFn(props.entity);

  return (
    <div class="soup-list-entity relative mx-(--sidebar-gutter) my-(--sidebar-row-gap)">
      <MaybeEntityRow
        entityId={props.occurrenceKey}
        config={props.entityRowConfig}
      >
        <Show
          when={props.entity.type === 'agent_session' && props.entity}
          fallback={
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
              <Switch fallback={<HomeEntityIcon entity={props.entity} />}>
                <Match when={threadEntity()}>
                  <ViewSidebar.Icon>
                    <ArrowBendUpLeftIcon class="size-4" />
                  </ViewSidebar.Icon>
                </Match>
                <Match when={commentNotification()}>
                  <ViewSidebar.Icon>
                    <ChatTeardropIcon class="size-4" />
                  </ViewSidebar.Icon>
                </Match>
              </Switch>
              <span
                class={cn(
                  'block min-w-0 flex-1 truncate font-normal',
                  unread() && 'text-ink'
                )}
              >
                <Switch
                  fallback={
                    <Show
                      when={props.channelName}
                      fallback={<Entity.Title entity={props.entity} />}
                    >
                      {props.channelName}
                    </Show>
                  }
                >
                  <Match when={threadEntity()}>
                    {(thread) => (
                      <HomeThreadTitle
                        entity={thread()}
                        channelName={props.channelName}
                      />
                    )}
                  </Match>
                  <Match when={commentNotification()}>
                    {(notification) => (
                      <HomeCommentTitle
                        entity={props.entity}
                        notification={notification()}
                      />
                    )}
                  </Match>
                </Switch>
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
          }
        >
          {(session) => (
            <AgentSessionListItem
              entity={session()}
              surface="home"
              active={props.checked || props.highlighted}
              unread={unread()}
              onOpen={(event) => {
                event.preventDefault();
                props.onClick?.(event);
              }}
            />
          )}
        </Show>
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

function HomeCommentTitle(props: {
  entity: HomeListEntityProps['entity'];
  notification: UnifiedNotification;
}) {
  const sender = () => {
    const senderId = props.notification.sender_id;
    if (senderId) {
      return (
        getDisplayName(tryMacroId(senderId), { emailFallback: 'local-part' }) ||
        'Someone'
      );
    }
    return getNotificationAgentSender(props.notification)?.name ?? 'Someone';
  };
  const action = () =>
    match(props.notification.notification_metadata.tag)
      .with('mentioned_in_document_comment', () => ' mentioned you on ')
      .with('replied_to_document_comment_thread', () => ' replied on ')
      .otherwise(() => ' commented on ');
  return (
    <span class="flex min-w-0 items-center">
      <span class="max-w-1/2 shrink-0 truncate">{sender()}</span>
      <span class="shrink-0 whitespace-pre">{action()}</span>
      <span class="min-w-0 truncate">
        <Entity.Title entity={props.entity} />
      </span>
    </span>
  );
}

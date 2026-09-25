import { dismissIncomingCallEverywhere } from '@app/features/block-call/sidebar/incoming-calls';
import {
  type EntityActionViewContext,
  toEntityActionListState,
} from '@app/features/next-soup/actions';
import { SoupEntityContextMenu } from '@app/features/soup/SoupEntityContextMenu';
import { joinChannelCall } from '@channel/Call/join-channel-call';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { inlineWrappingMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getDisplayName, tryMacroId } from '@core/user';
import type { MacroId } from '@core/user/macroId';
import { type ChannelEntity, Entity } from '@entity';
import ReplyIcon from '@phosphor/arrow-bend-up-left.svg';
import AtIcon from '@phosphor/at.svg';
import BellSlashIcon from '@phosphor/bell-slash.svg';
import XIcon from '@phosphor/x.svg';
import PhoneCallIcon from '@phosphor-fill/phone-call-fill.svg';
import PhoneIncomingIcon from '@phosphor-fill/phone-incoming-fill.svg';
import { getBotDisplayName } from '@queries/messages/message-sender';
import { Button, cn, Tooltip } from '@ui';
import { type JSX, Match, type ParentProps, Show, Switch } from 'solid-js';
import { formatDetailedTimestamp, isDirectMessage } from '../../utils';
import { rowKeyForChannel, useChannelsRail } from './ChannelsRailContext';

export type ChannelCallStatus = 'active' | 'incoming';

export const CONVERSATION_CARD_HEIGHT = 80;

export type ChannelRailItemProps = {
  id: string;
  channel: ChannelEntity;
  unread: boolean;
  muted: boolean;
  callStatus?: ChannelCallStatus;
  incomingCallId?: string;
  selected: boolean;
  focused: boolean;
  onActivate: (event: MouseEvent) => void;
};

export const CHANNEL_ACTION_VIEW_CONTEXT: EntityActionViewContext = {
  supportsMarkDone: false,
  senderBucket: undefined,
};

/**
 * Rail rows activate on mousedown rather than click so the selection lands
 * the instant the button goes down. Only the primary button counts: the
 * context menu owns the secondary button and middle-click stays inert.
 */
export function isPrimaryMouseDown(event: MouseEvent) {
  return event.button === 0;
}

export function ChannelRailItemContextMenu(
  props: ParentProps<{
    channel: ChannelEntity;
    class?: string;
    /** Rail-specific items shown after the entity actions. */
    extraItems?: JSX.Element;
  }>
) {
  const rail = useChannelsRail();
  const actionList = toEntityActionListState({
    controller: rail.list,
    getEntity: (row) => (row.kind === 'conversation' ? row.channel : undefined),
  });

  return (
    <SoupEntityContextMenu
      entity={props.channel}
      list={actionList}
      selectedEntities={() => []}
      viewContext={CHANNEL_ACTION_VIEW_CONTEXT}
      class={props.class}
      extraItems={props.extraItems}
      onOpenChange={(open) => {
        if (!open) return;

        rail.list.focus.set(rowKeyForChannel(props.channel.id), {
          reason: 'pointer',
          force: true,
        });
      }}
    >
      {props.children}
    </SoupEntityContextMenu>
  );
}

export function ChannelCallIndicator(props: {
  status: ChannelCallStatus | undefined;
  class?: string;
}) {
  return (
    <Show when={props.status}>
      {(status) => (
        <span
          aria-label={status() === 'incoming' ? 'Incoming call' : 'Active call'}
          class={cn(
            'flex size-4 shrink-0 items-center justify-center text-accent',
            props.class
          )}
        >
          <Switch>
            <Match when={status() === 'incoming'}>
              <PhoneIncomingIcon class="incoming-call-shake size-full" />
            </Match>
            <Match when={true}>
              <PhoneCallIcon class="size-full" />
            </Match>
          </Switch>
        </span>
      )}
    </Show>
  );
}

export function ChannelMutedIndicator(props: {
  muted: boolean;
  class?: string;
}) {
  return (
    <Show when={props.muted}>
      <Tooltip
        as="span"
        label="Notifications are muted"
        placement="top"
        class={cn(
          'size-4 shrink-0 justify-center text-ink-extra-muted',
          props.class
        )}
      >
        <span
          aria-label="Notifications muted"
          class="flex size-full items-center justify-center"
        >
          <BellSlashIcon class="size-full" />
        </span>
      </Tooltip>
    </Show>
  );
}

export function IncomingCallActions(props: {
  callId: string | undefined;
  channelId: string;
  class?: string;
  layout?: 'compact' | 'wide';
}) {
  const isWide = () => props.layout === 'wide';

  return (
    <Show when={props.callId}>
      {(callId) => (
        <span
          class={cn(
            'shrink-0 items-center',
            isWide() ? 'grid w-full grid-cols-2 gap-2' : 'flex gap-1',
            props.class
          )}
        >
          <Button
            variant="danger"
            size={isWide() ? 'sm' : 'icon-xs'}
            fullWidth={isWide()}
            class={cn('rounded-md', isWide() && 'h-7 flex-1')}
            label="Decline incoming call"
            tooltipDisabled={isWide()}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              dismissIncomingCallEverywhere(callId());
            }}
          >
            <XIcon class="size-3" />
            <Show when={isWide()}>Decline</Show>
          </Button>
          <Button
            variant="success"
            size={isWide() ? 'sm' : 'icon-xs'}
            fullWidth={isWide()}
            class={cn('rounded-md', isWide() && 'h-7 flex-1')}
            label="Accept incoming call"
            tooltipDisabled={isWide()}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void joinChannelCall(props.channelId).catch((error) => {
                console.error('Failed to join call', error);
                toast.failure('Failed to join call');
              });
            }}
          >
            <PhoneIncomingIcon class="incoming-call-shake size-3" />
            <Show when={isWide()}>Join</Show>
          </Button>
        </span>
      )}
    </Show>
  );
}

export function ChannelAvatar(props: {
  channel: ChannelEntity;
  size?: 'sm' | 'md';
}) {
  const sizeClass = () =>
    props.size === 'md' ? 'size-9 [&_svg]:size-4.5' : 'size-5 [&_svg]:size-4';

  return (
    <Switch>
      <Match when={isDirectMessage(props.channel)}>
        <span
          class={cn(
            'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-edge bg-surface-2 [&_img]:size-full [&_svg]:shrink-0',
            sizeClass()
          )}
        >
          <Entity.Icon
            entity={props.channel}
            suppressClick
            showTooltip={false}
          />
        </span>
      </Match>
      <Match when={true}>
        <span
          class={cn(
            'flex shrink-0 items-center justify-center text-ink-muted [&_svg]:shrink-0',
            sizeClass()
          )}
        >
          <Entity.Icon
            entity={props.channel}
            suppressClick
            showTooltip={false}
          />
        </span>
      </Match>
    </Switch>
  );
}

export type ConversationCardProps = ChannelRailItemProps & {
  class?: string;
  showLatestMessage?: boolean;
  senderId?: string;
  mentionedCurrentUser: boolean;
};

function UserDisplayName(props: { id: MacroId }) {
  const displayName = () =>
    getDisplayName(props.id, {
      emailFallback: 'local-part',
    });

  return <>{displayName()}</>;
}

function MessageSenderName(props: { id?: string }) {
  const currentUserId = useUserId();
  const macroId = () => (props.id ? tryMacroId(props.id) : undefined);
  const botName = () => (props.id ? getBotDisplayName(props.id) : undefined);
  const isCurrentUser = () =>
    props.id?.toLocaleLowerCase() === currentUserId()?.toLocaleLowerCase();

  return (
    <Switch>
      <Match when={!props.id}>Unknown sender</Match>
      <Match when={isCurrentUser()}>You</Match>
      <Match when={botName()}>{(name) => name()}</Match>
      <Match when={macroId()}>{(id) => <UserDisplayName id={id()} />}</Match>
      <Match when={true}>Someone</Match>
    </Switch>
  );
}

export function ConversationCard(props: ConversationCardProps) {
  const latestRootMessage = () => props.channel.latestRootMessage;
  const hasMessageMetadata = () =>
    Boolean(latestRootMessage()?.threadId || props.mentionedCurrentUser);

  return (
    <div
      id={props.id}
      role="treeitem"
      tabIndex={-1}
      class={cn(
        'relative min-h-20 w-full min-w-0 overflow-hidden px-2 py-4 text-left outline-none',
        props.selected && !isTouchDevice() && 'bg-active',
        !props.selected && !isTouchDevice() && props.focused && 'bg-hover',
        (!props.selected || isTouchDevice()) && 'bg-transparent',
        !props.selected &&
          !isTouchDevice() &&
          !props.focused &&
          'hover:bg-hover',
        props.class
      )}
      aria-current={props.selected ? 'page' : undefined}
      onMouseDown={(event) => {
        if (isPrimaryMouseDown(event)) props.onActivate(event);
      }}
    >
      <div
        class={cn(
          'flex min-w-0 gap-3 overflow-hidden',
          props.showLatestMessage === false ? 'items-center' : 'items-start'
        )}
      >
        <ChannelAvatar channel={props.channel} size="md" />
        <div class="min-w-0 flex-1 overflow-hidden">
          <span class="flex min-w-0 items-center gap-2">
            <Show when={props.unread}>
              <span
                aria-label="Unread"
                class="size-2 shrink-0 rounded-full bg-accent touch:absolute touch:left-2 touch:top-7.5 touch:-translate-y-1/2"
              />
            </Show>
            <span class="min-w-0 flex-1 truncate text-sm font-medium text-ink">
              {props.channel.name}
            </span>
            <ChannelMutedIndicator muted={props.muted} class="size-3.5" />
            <ChannelCallIndicator
              status={props.incomingCallId ? undefined : props.callStatus}
              class="size-3.5"
            />
            <Show when={latestRootMessage()?.createdAt}>
              {(createdAt) => (
                <Tooltip
                  label={formatDetailedTimestamp(createdAt())}
                  placement="top"
                >
                  <span class="shrink-0 text-xs text-ink-extra-muted">
                    <Entity.Timestamp
                      entity={props.channel}
                      overrideTimeStamp={createdAt()}
                    />
                  </span>
                </Tooltip>
              )}
            </Show>
          </span>
          <Show when={props.showLatestMessage !== false}>
            <Show when={hasMessageMetadata()}>
              <span class="flex min-w-0 items-center gap-2 text-xxs leading-4 text-ink-extra-muted">
                <Show when={latestRootMessage()?.threadId}>
                  <span
                    class="flex shrink-0 items-center gap-1"
                    title="Reply in thread"
                  >
                    <ReplyIcon class="size-3" />
                    <span>Reply</span>
                  </span>
                </Show>
                <Show when={props.mentionedCurrentUser}>
                  <span class="flex shrink-0 items-center gap-1 text-accent">
                    <AtIcon class="size-3" />
                    <span>Mentioned you</span>
                  </span>
                </Show>
              </span>
            </Show>
            <div class="min-w-0 overflow-hidden text-sm">
              <Switch>
                <Match when={latestRootMessage()}>
                  {(message) => (
                    <div class="line-clamp-2 min-w-0 text-ink-muted">
                      <span class="inline-flex min-w-0 font-medium">
                        <span class="min-w-0 truncate">
                          <MessageSenderName id={props.senderId} />
                        </span>
                        <span class="shrink-0">:</span>
                      </span>{' '}
                      <Show when={message().content.trim()}>
                        {(content) => (
                          <StaticMarkdown
                            markdown={content()}
                            singleLine
                            theme={inlineWrappingMarkdownTheme}
                          />
                        )}
                      </Show>
                    </div>
                  )}
                </Match>
                <Match when={true}>
                  <span class="min-w-0 flex-1 text-ink-extra-muted">
                    Send the first message
                  </span>
                </Match>
              </Switch>
            </div>
          </Show>
          <IncomingCallActions
            callId={props.incomingCallId}
            channelId={props.channel.id}
            class="mt-3"
            layout="wide"
          />
        </div>
      </div>
    </div>
  );
}

import { dismissIncomingCallEverywhere } from '@app/features/block-call/sidebar/incoming-calls';
import { joinChannelCall } from '@channel/Call/join-channel-call';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getDisplayName, tryMacroId } from '@core/user';
import type { MacroId } from '@core/user/macroId';
import { type ChannelEntity, Entity } from '@entity';
import ReplyIcon from '@phosphor/arrow-bend-up-left.svg';
import AtIcon from '@phosphor/at.svg';
import XIcon from '@phosphor/x.svg';
import PhoneCallIcon from '@phosphor-fill/phone-call-fill.svg';
import PhoneIncomingIcon from '@phosphor-fill/phone-incoming-fill.svg';
import { getBotDisplayName } from '@queries/channel/message-sender';
import { Button, cn, Tooltip } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import { formatDetailedTimestamp, isDirectMessage } from '../../utils';

export type ChannelCallStatus = 'active' | 'incoming';

export type ChannelRailItemProps = {
  id: string;
  channel: ChannelEntity;
  unread: boolean;
  callStatus?: ChannelCallStatus;
  incomingCallId?: string;
  selected: boolean;
  focused: boolean;
  onActivate: () => void;
};

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

export function IncomingCallActions(props: {
  callId: string | undefined;
  channelId: string;
}) {
  return (
    <Show when={props.callId}>
      {(callId) => (
        <span class="flex shrink-0 items-center gap-1">
          <Button
            variant="success"
            size="icon-xs"
            class="rounded-md"
            label="Accept incoming call"
            onPointerDown={(event) => event.stopPropagation()}
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
          </Button>
          <Button
            variant="danger"
            size="icon-xs"
            class="rounded-md"
            label="Decline incoming call"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              dismissIncomingCallEverywhere(callId());
            }}
          >
            <XIcon class="size-3" />
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
    props.size === 'md' ? 'size-9 [&_svg]:size-4.5' : 'size-6 [&_svg]:size-3.5';

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

  return (
    <div
      id={props.id}
      role="treeitem"
      tabIndex={-1}
      class={cn(
        'relative w-full min-w-0 overflow-hidden px-2 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent touch:focus-visible:ring-0',
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
      onClick={props.onActivate}
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
            <ChannelCallIndicator
              status={props.incomingCallId ? undefined : props.callStatus}
            />
            <IncomingCallActions
              callId={props.incomingCallId}
              channelId={props.channel.id}
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
            <Show
              when={latestRootMessage()?.threadId || props.mentionedCurrentUser}
            >
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
            <div class="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-xs leading-4">
              <Switch>
                <Match when={latestRootMessage()}>
                  {(message) => (
                    <>
                      <span class="shrink-0 font-medium text-ink-muted">
                        <MessageSenderName id={props.senderId} />:
                      </span>
                      <Show when={message().content.trim()}>
                        {(content) => (
                          <div class="min-w-0 flex-1 truncate text-ink-muted [&_*]:my-0 [&_*]:truncate">
                            <StaticMarkdown markdown={content()} singleLine />
                          </div>
                        )}
                      </Show>
                    </>
                  )}
                </Match>
                <Match when={true}>
                  <span class="min-w-0 flex-1 text-ink-extra-muted">
                    No messages yet
                  </span>
                </Match>
              </Switch>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

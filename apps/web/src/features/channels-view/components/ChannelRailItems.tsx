import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import type { MacroId } from '@core/user/macroId';
import { type ChannelEntity, Entity } from '@entity';
import ReplyIcon from '@phosphor/arrow-bend-up-left.svg';
import AtIcon from '@phosphor/at.svg';
import { cn, Tooltip } from '@ui';
import { Show } from 'solid-js';
import { channelInitials, formatDetailedTimestamp } from '../utils';

function ChannelAvatar(props: { channel: ChannelEntity; size?: 'sm' | 'md' }) {
  const sizeClass = () =>
    props.size === 'md' ? 'size-9 [&_svg]:size-4.5' : 'size-6 [&_svg]:size-3.5';

  return (
    <Show
      when={props.channel.channelType === 'direct_message'}
      fallback={
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
      }
    >
      <span
        class={cn(
          'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-edge bg-surface-2 [&_img]:size-full [&_svg]:shrink-0',
          sizeClass()
        )}
      >
        <Entity.Icon entity={props.channel} suppressClick showTooltip={false} />
      </span>
    </Show>
  );
}

function SlimChannelAvatar(props: { channel: ChannelEntity }) {
  return (
    <Show
      when={props.channel.channelType === 'direct_message'}
      fallback={
        <span class="flex size-6 shrink-0 items-center justify-center rounded-full border border-edge bg-surface-2 text-xxs font-semibold tracking-wide text-ink">
          {channelInitials(props.channel.name)}
        </span>
      }
    >
      <span class="relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-edge bg-surface-2 [&_img]:size-full [&_svg]:size-3.5 [&_svg]:shrink-0">
        <Entity.Icon entity={props.channel} suppressClick showTooltip={false} />
      </span>
    </Show>
  );
}

type ChannelOptionProps = {
  id: string;
  channel: ChannelEntity;
  unread: boolean;
  selected: boolean;
  focused: boolean;
  onActivate: () => void;
};

export function ChannelOption(props: ChannelOptionProps) {
  return (
    <button
      id={props.id}
      type="button"
      role="treeitem"
      tabIndex={-1}
      class={cn(
        'relative flex w-full min-w-0 items-center gap-2 rounded-xl px-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent',
        props.channel.channelType === 'direct_message'
          ? 'min-h-10 py-2'
          : 'h-8',
        props.selected && 'bg-active text-ink',
        !props.selected && props.focused && 'bg-hover text-ink',
        !props.selected &&
          !props.focused &&
          'text-ink-muted hover:bg-hover hover:text-ink'
      )}
      aria-current={props.selected ? 'page' : undefined}
      onClick={props.onActivate}
    >
      <ChannelAvatar channel={props.channel} />
      <span class="min-w-0 flex-1 truncate text-sm font-medium">
        {props.channel.name}
      </span>
      <Show when={props.unread}>
        <span
          aria-label="Unread"
          class="size-2 shrink-0 rounded-full bg-accent"
        />
      </Show>
    </button>
  );
}

export function SlimChannelOption(props: ChannelOptionProps) {
  return (
    <Tooltip label={props.channel.name} placement="right" class="size-10">
      <button
        id={props.id}
        type="button"
        role="treeitem"
        tabIndex={-1}
        class={cn(
          'relative flex size-10 min-h-10 items-center justify-center rounded-full text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent',
          props.selected && 'bg-active text-ink',
          !props.selected && props.focused && 'bg-hover text-ink',
          !props.selected &&
            !props.focused &&
            'text-ink-muted hover:bg-hover hover:text-ink'
        )}
        aria-current={props.selected ? 'page' : undefined}
        onClick={props.onActivate}
      >
        <SlimChannelAvatar channel={props.channel} />
        <Show when={props.unread}>
          <span
            aria-label="Unread"
            class="absolute right-1.5 top-1 size-2 rounded-full bg-accent"
          />
        </Show>
      </button>
    </Tooltip>
  );
}

type ConversationCardProps = {
  id: string;
  channel: ChannelEntity;
  senderId?: string;
  mentionedCurrentUser: boolean;
  unread: boolean;
  selected: boolean;
  focused: boolean;
  onActivate: () => void;
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
  const isCurrentUser = () =>
    props.id?.toLocaleLowerCase() === currentUserId()?.toLocaleLowerCase();

  return (
    <Show when={props.id} fallback={<>Unknown sender</>}>
      {(senderId) => (
        <Show when={!isCurrentUser()} fallback={<>You</>}>
          <Show
            when={macroId()}
            fallback={senderId().startsWith('bot|') ? 'Bot' : 'Someone'}
          >
            {(id) => <UserDisplayName id={id()} />}
          </Show>
        </Show>
      )}
    </Show>
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
        'w-full min-w-0 overflow-hidden px-2 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
        props.selected && 'bg-active',
        !props.selected && props.focused && 'bg-hover',
        !props.selected && !props.focused && 'bg-transparent hover:bg-hover'
      )}
      aria-current={props.selected ? 'page' : undefined}
      onClick={props.onActivate}
    >
      <div class="flex min-w-0 items-start gap-3 overflow-hidden">
        <ChannelAvatar channel={props.channel} size="md" />
        <div class="min-w-0 flex-1 overflow-hidden">
          <span class="flex min-w-0 items-center gap-2">
            <span class="min-w-0 flex-1 truncate text-sm font-medium text-ink">
              {props.channel.name}
            </span>
            <Show when={props.unread}>
              <span
                aria-label="Unread"
                class="size-2 shrink-0 rounded-full bg-accent"
              />
            </Show>
            <Show when={latestRootMessage()?.createdAt}>
              {(createdAt) => (
                <Tooltip
                  label={formatDetailedTimestamp(createdAt())}
                  placement="top"
                >
                  <span class="shrink-0 text-xxs text-ink-extra-muted">
                    <Entity.Timestamp
                      entity={props.channel}
                      overrideTimeStamp={createdAt()}
                    />
                  </span>
                </Tooltip>
              )}
            </Show>
          </span>
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
            <span class="shrink-0 font-medium text-ink-muted">
              <MessageSenderName id={props.senderId} />:
            </span>
            <Show
              when={latestRootMessage()?.content.trim()}
              fallback={
                <span class="min-w-0 flex-1 text-ink-extra-muted">
                  No messages yet
                </span>
              }
            >
              {(content) => (
                <div class="min-w-0 flex-1 truncate text-ink-muted [&_*]:my-0 [&_*]:truncate">
                  <StaticMarkdown markdown={content()} singleLine />
                </div>
              )}
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SlimConversationCard(props: ConversationCardProps) {
  return (
    <Tooltip
      label={props.channel.name}
      placement="right"
      class="size-10 self-center"
    >
      <button
        id={props.id}
        type="button"
        role="treeitem"
        tabIndex={-1}
        class={cn(
          'flex size-10 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
          props.selected && 'bg-active',
          !props.selected && props.focused && 'bg-hover',
          !props.selected && !props.focused && 'bg-transparent hover:bg-hover'
        )}
        aria-current={props.selected ? 'page' : undefined}
        onClick={props.onActivate}
      >
        <span class="relative">
          <SlimChannelAvatar channel={props.channel} />
          <Show when={props.unread}>
            <span
              aria-label="Unread"
              class="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-accent ring-2 ring-surface"
            />
          </Show>
        </span>
      </button>
    </Tooltip>
  );
}

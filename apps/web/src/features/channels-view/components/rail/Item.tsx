import { dismissIncomingCallEverywhere } from '@app/features/block-call/sidebar/incoming-calls';
import { joinChannelCall } from '@channel/Call/join-channel-call';
import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type ChannelEntity, Entity } from '@entity';
import XIcon from '@phosphor/x.svg';
import PhoneCallIcon from '@phosphor-fill/phone-call-fill.svg';
import PhoneIncomingIcon from '@phosphor-fill/phone-incoming-fill.svg';
import { Button, cn, Tooltip } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import { channelInitials, isDirectMessage } from '../../utils';

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

function SlimChannelAvatar(props: { channel: ChannelEntity }) {
  return (
    <Switch>
      <Match when={isDirectMessage(props.channel)}>
        <span class="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-edge bg-surface-2 [&_img]:size-full [&_svg]:size-4 [&_svg]:shrink-0">
          <Entity.Icon
            entity={props.channel}
            suppressClick
            showTooltip={false}
          />
        </span>
      </Match>
      <Match when={true}>
        <span class="flex size-8 shrink-0 items-center justify-center rounded-full border border-edge bg-surface-2 text-xs font-semibold tracking-wide text-ink">
          {channelInitials(props.channel.name)}
        </span>
      </Match>
    </Switch>
  );
}

export function ChannelOption(props: ChannelRailItemProps) {
  return (
    <div
      id={props.id}
      role="treeitem"
      tabIndex={-1}
      class={cn(
        'relative flex w-full min-w-0 items-center gap-2 rounded-xl px-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent touch:focus-visible:ring-0',
        isDirectMessage(props.channel) ? 'min-h-10 py-2' : 'h-8',
        props.selected && !isTouchDevice() && 'bg-active text-ink',
        (!props.selected || isTouchDevice()) && 'text-ink-muted',
        !props.selected &&
          !isTouchDevice() &&
          props.focused &&
          'bg-hover text-ink',
        !props.selected &&
          !isTouchDevice() &&
          !props.focused &&
          'hover:bg-hover hover:text-ink'
      )}
      aria-current={props.selected ? 'page' : undefined}
      onClick={props.onActivate}
    >
      <ChannelAvatar channel={props.channel} />
      <span class="min-w-0 flex-1 truncate text-sm font-medium">
        {props.channel.name}
      </span>
      <ChannelCallIndicator
        status={props.incomingCallId ? undefined : props.callStatus}
      />
      <IncomingCallActions
        callId={props.incomingCallId}
        channelId={props.channel.id}
      />
      <Show when={props.unread}>
        <span
          aria-label="Unread"
          class="size-2 shrink-0 rounded-full bg-accent"
        />
      </Show>
    </div>
  );
}

export function SlimChannelItem(props: ChannelRailItemProps) {
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
          'flex size-10 items-center justify-center rounded-full text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent touch:focus-visible:ring-0',
          props.selected && !isTouchDevice() && 'bg-active text-ink',
          (!props.selected || isTouchDevice()) && 'text-ink-muted',
          !props.selected &&
            !isTouchDevice() &&
            props.focused &&
            'bg-hover text-ink',
          !props.selected &&
            !isTouchDevice() &&
            !props.focused &&
            'hover:bg-hover hover:text-ink'
        )}
        aria-current={props.selected ? 'page' : undefined}
        onClick={props.onActivate}
      >
        <span class="relative">
          <SlimChannelAvatar channel={props.channel} />
          <ChannelCallIndicator
            status={props.callStatus}
            class="absolute -bottom-0.5 -right-0.5 rounded-full bg-inset p-0.5"
          />
          <Show when={props.unread}>
            <span
              aria-label="Unread"
              class="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-accent ring-2 ring-surface"
            />
          </Show>
        </span>
      </button>
    </Tooltip>
  );
}

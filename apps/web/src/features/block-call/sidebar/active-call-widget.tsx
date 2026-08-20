import { joinChannelCall } from '@channel/Call/join-channel-call';
import { openChannelCallTab } from '@channel/Call/open-channel-call-tab';
import type { SidebarState } from '@components/app/app-sidebar/sidebar';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import PhoneIcon from '@icon/wide-call.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import XIcon from '@phosphor/x.svg';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import { ChannelTypeEnum } from '@service-storage/client';
import { Avatar, Button, cn, Tooltip } from '@ui';
import { createMemo, type FlowComponent, For, Show } from 'solid-js';
import {
  dismissIncomingCallEverywhere,
  useVisibleIncomingCalls,
} from './incoming-calls';

const SLIM_MAX = 4;

function displayName(channel: ApiChannelWithLatest | undefined) {
  if (!channel) return 'Channel';
  if (channel.channel_type === ChannelTypeEnum.DirectMessage) {
    return channel.name || 'Direct message';
  }
  return channel.name ? `#${channel.name}` : 'Channel';
}

function ChannelCallBadge(props: {
  channel: ApiChannelWithLatest | undefined;
  letters: string;
  slim: boolean;
}) {
  return (
    <div class="relative flex items-center justify-center shrink-0 size-[22px]">
      <Avatar size="fill" class="bg-ink-extra-muted/15 text-ink-muted">
        <Avatar.Fallback class="font-semibold">{props.letters}</Avatar.Fallback>
      </Avatar>
      <Show when={props.slim}>
        <span class="absolute -top-0.5 -right-0.5 size-1.5 bg-success rounded-full ring-surface ring-2" />
      </Show>
    </div>
  );
}

function computeChannelLetters(
  calls: { channel: ApiChannelWithLatest | undefined; channelId: string }[],
  currentUserId?: string
): Map<string, string> {
  const result = new Map<string, string>();
  const firstLetterCount = new Map<string, number>();
  const getName = (channel: ApiChannelWithLatest) => {
    const channelName = channel.name?.trim();
    if (channelName) return channelName;

    if (channel.channel_type !== ChannelTypeEnum.DirectMessage) return '';

    const participant =
      channel.participants.find((p) => p.user_id !== currentUserId) ??
      channel.participants[0];
    if (!participant) return '';

    const displayName =
      'displayName' in participant &&
      typeof participant.displayName === 'string'
        ? participant.displayName
        : undefined;
    return displayName?.trim() || participant.user_id;
  };

  for (const call of calls) {
    const channel = call.channel;
    if (!channel) continue;
    const name = getName(channel);
    const first = name[0]?.toUpperCase() ?? '';
    firstLetterCount.set(first, (firstLetterCount.get(first) ?? 0) + 1);
  }

  for (const call of calls) {
    const channel = call.channel;
    if (!channel) continue;
    const name = getName(channel);
    const first = name[0]?.toUpperCase() ?? '';
    const needsTwo = (firstLetterCount.get(first) ?? 0) > 1 && name.length > 1;
    result.set(
      call.channelId,
      needsTwo ? first + name[1].toUpperCase() : first
    );
  }

  return result;
}

type IncomingCallContextMenuProps = {
  callId: string;
  channelId: string;
  onDismiss: () => void;
};

const IncomingCallContextMenu: FlowComponent<IncomingCallContextMenuProps> = (
  props
) => {
  return (
    <ContextMenu>
      <ContextMenu.Trigger class="size-full group/cm-trigger">
        {props.children}
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenuContent class="text-xs text-ink-muted">
          <MenuItem
            text="Join call"
            onClick={() => void joinChannelCall(props.channelId)}
          />
          <MenuItem text="Dismiss" onClick={props.onDismiss} />
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
};

export function SidebarActiveCallWidget(props: {
  sidebarState: SidebarState;
  class?: string;
}) {
  const channelsCtx = useChannelsContext();
  const userId = useUserId();

  const activeCalls = useVisibleIncomingCalls();

  const activeCallChannels = createMemo(() =>
    activeCalls().map((call) => ({
      channelId: call.channelId,
      channel: channelsCtx.channelsById()[call.channelId],
    }))
  );

  const channelLetters = createMemo(() =>
    computeChannelLetters(activeCallChannels(), userId())
  );

  const isSlim = () => props.sidebarState === 'slim';
  const slimVisible = () => activeCalls().slice(0, SLIM_MAX);
  const slimOverflow = () => Math.max(0, activeCalls().length - SLIM_MAX);

  return (
    <Show when={activeCalls().length > 0}>
      <Show
        when={!isSlim()}
        fallback={
          <section
            class={cn('w-full p-2 flex flex-col items-center', props.class)}
          >
            <For each={slimVisible()}>
              {(call) => {
                const channel = () =>
                  channelsCtx.channelsById()[call.channelId];
                return (
                  <div class="size-8">
                    <IncomingCallContextMenu
                      callId={call.callId}
                      channelId={call.channelId}
                      onDismiss={() =>
                        dismissIncomingCallEverywhere(call.callId)
                      }
                    >
                      <Button
                        aria-label={`${displayName(channel())} call`}
                        class="relative flex items-center cursor-default rounded-md text-ink-extra-muted not-disabled:hover:bg-ink/3 justify-center size-8"
                        draggable={false}
                        variant="ghost"
                        size="sm"
                        onMouseDown={(e) => {
                          if (e.button !== 0) return;
                          e.preventDefault();
                          void openChannelCallTab(call.channelId);
                        }}
                      >
                        <ChannelCallBadge
                          channel={channel()}
                          letters={channelLetters().get(call.channelId) ?? '?'}
                          slim
                        />
                      </Button>
                    </IncomingCallContextMenu>
                  </div>
                );
              }}
            </For>
            <Show when={slimOverflow() > 0}>
              <span class="text-xxs text-ink-muted mt-1">
                +{slimOverflow()}
              </span>
            </Show>
          </section>
        }
      >
        <section
          class={cn('size-full flex flex-col justify-center', props.class)}
        >
          <header class="text-xs font-medium text-ink-muted whitespace-nowrap p-2">
            <h1>Incoming call</h1>
          </header>

          <div class="flex-1 w-full">
            <For each={activeCalls()}>
              {(call) => {
                const channel = () =>
                  channelsCtx.channelsById()[call.channelId];
                const dismissLabel = () =>
                  `Dismiss ${displayName(channel())} call`;
                const openCall = () => {
                  void openChannelCallTab(call.channelId);
                };

                return (
                  <div class="w-full">
                    <IncomingCallContextMenu
                      callId={call.callId}
                      channelId={call.channelId}
                      onDismiss={() =>
                        dismissIncomingCallEverywhere(call.callId)
                      }
                    >
                      <div class="flex items-center gap-1.5 w-full rounded-lg p-2 text-ink-extra-muted hover:bg-ink/3">
                        <button
                          type="button"
                          class="flex min-w-0 flex-1 items-center justify-start gap-2 cursor-default"
                          draggable={false}
                          onMouseDown={(e) => {
                            if (e.button !== 0) return;
                            e.preventDefault();
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            openCall();
                          }}
                        >
                          <ChannelCallBadge
                            channel={channel()}
                            letters={
                              channelLetters().get(call.channelId) ?? '?'
                            }
                            slim={false}
                          />
                          <span class="text-sm font-medium truncate">
                            {displayName(channel())}
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Join ${displayName(channel())} call`}
                          class="shrink-0 size-5 flex items-center justify-center text-xs font-medium bg-success/15 text-success rounded-md"
                          draggable={false}
                          onMouseDown={(e) => {
                            if (e.button !== 0) return;
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openCall();
                          }}
                        >
                          <PhoneIcon class="size-3" />
                        </button>
                        <Tooltip label={dismissLabel()} placement="right">
                          <Button
                            aria-label={dismissLabel()}
                            class="shrink-0 size-5 p-0 flex items-center justify-center rounded-md bg-ink-muted/10 text-ink-muted/80 not-disabled:hover:bg-failure/10 not-disabled:hover:text-failure"
                            draggable={false}
                            variant="ghost"
                            size="sm"
                            onMouseDown={(e) => {
                              if (e.button !== 0) return;
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              dismissIncomingCallEverywhere(call.callId);
                            }}
                          >
                            <XIcon class="size-3" />
                          </Button>
                        </Tooltip>
                      </div>
                    </IncomingCallContextMenu>
                  </div>
                );
              }}
            </For>
          </div>
        </section>
      </Show>
    </Show>
  );
}

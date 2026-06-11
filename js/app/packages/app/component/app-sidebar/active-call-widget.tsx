import {
  joinChannelCall,
  openChannelCallTab,
  stopCallRinger,
  useCallContextOptional,
} from '@channel/Call';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import PhoneIcon from '@icon/wide-call.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import { ChannelTypeEnum } from '@service-storage/client';
import { Avatar, Button, cn, Tooltip } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  type FlowComponent,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import type { SidebarState } from './sidebar';

const SLIM_MAX = 4;
const MAX_RING_DURATION_MS = 30_000;

type IncomingCall = {
  channelId: string;
  callId: string;
  createdAt: string;
  createdBy: string | null;
};

type CallStartedPayload = {
  channel_id?: string;
  call_id?: string;
  created_by?: string | null;
};

type CallEndedPayload = {
  channel_id?: string;
  call_id?: string;
};

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
    <div class="relative flex items-center justify-center shrink-0 size-5">
      <Avatar size="md" class="bg-ink-extra-muted/15 text-ink-muted">
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

function formatDuration(startedAt: string | undefined, nowMs: number) {
  const startedAtMs = startedAt ? new Date(startedAt).getTime() : Number.NaN;
  if (!Number.isFinite(startedAtMs)) return '';

  const totalSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function parsePayload(raw: unknown): CallStartedPayload | null {
  const obj =
    typeof raw === 'string'
      ? safeJsonParse(raw)
      : typeof raw === 'object'
        ? raw
        : null;
  if (!obj || typeof obj !== 'object') return null;
  return obj as CallStartedPayload;
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

export function SidebarActiveCallWidget(props: { sidebarState: SidebarState }) {
  const channelsCtx = useChannelsContext();
  const callCtx = useCallContextOptional();
  const userId = useUserId();
  const [incomingCalls, setIncomingCalls] = createSignal<IncomingCall[]>([]);
  const incomingCallTimeouts = new Map<string, number>();
  const [nowMs, setNowMs] = createSignal(Date.now());
  const durationTimer = globalThis.setInterval(
    () => setNowMs(Date.now()),
    1000
  );
  onCleanup(() => {
    globalThis.clearInterval(durationTimer);
    for (const timeoutId of incomingCallTimeouts.values()) {
      window.clearTimeout(timeoutId);
    }
    incomingCallTimeouts.clear();
  });

  const dismissIncomingCall = (callId: string) => {
    stopCallRinger(callId);
    const timeoutId = incomingCallTimeouts.get(callId);
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      incomingCallTimeouts.delete(callId);
    }
    setIncomingCalls((calls) => calls.filter((call) => call.callId !== callId));
  };

  const addIncomingCall = (call: IncomingCall) => {
    const existingTimeoutId = incomingCallTimeouts.get(call.callId);
    if (existingTimeoutId !== undefined) {
      window.clearTimeout(existingTimeoutId);
    }
    incomingCallTimeouts.set(
      call.callId,
      window.setTimeout(
        () => dismissIncomingCall(call.callId),
        MAX_RING_DURATION_MS
      )
    );

    setIncomingCalls((calls) => {
      const withoutDuplicate = calls.filter(
        (candidate) =>
          candidate.callId !== call.callId &&
          candidate.channelId !== call.channelId
      );
      return [call, ...withoutDuplicate].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });
  };

  createEffect(() => {
    const activeCallId = callCtx?.activeCallId();
    if (activeCallId) dismissIncomingCall(activeCallId);
  });

  createConnectionWebsocketEffect((data) => {
    if (!ENABLE_CALLS()) return;

    const payload = parsePayload(data.data);
    if (!payload) return;

    if (data.type === 'call_ended') {
      const { channel_id: channelId, call_id: callId } =
        payload as CallEndedPayload;
      if (!channelId || !callId) return;

      dismissIncomingCall(callId);
      return;
    }

    if (data.type !== 'call_started') return;

    const {
      channel_id: channelId,
      call_id: callId,
      created_by: createdBy,
    } = payload;
    if (!channelId || !callId) return;
    if (callCtx?.activeCallId() === callId) return;
    if (createdBy && createdBy === userId()) return;

    addIncomingCall({
      channelId,
      callId,
      createdAt: new Date().toISOString(),
      createdBy: createdBy ?? null,
    });
  });

  const activeCalls = createMemo(() => {
    const channelsById = channelsCtx.channelsById();
    const joinedChannelId = callCtx?.isInCall()
      ? callCtx.activeChannelId()
      : null;
    const joinedCallId = callCtx?.isInCall() ? callCtx.activeCallId() : null;

    return incomingCalls()
      .filter((call) => {
        if (!channelsById[call.channelId]) return false;
        return (
          call.channelId !== joinedChannelId && call.callId !== joinedCallId
        );
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  });

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
          <section class="w-full p-2 flex flex-col items-center">
            <For each={slimVisible()}>
              {(call) => {
                const channel = () =>
                  channelsCtx.channelsById()[call.channelId];
                const duration = () => formatDuration(call.createdAt, nowMs());
                const label = () => {
                  const time = duration();
                  return time
                    ? `${displayName(channel())} call - ${time}`
                    : `${displayName(channel())} call`;
                };
                return (
                  <div class="size-8">
                    <IncomingCallContextMenu
                      callId={call.callId}
                      channelId={call.channelId}
                      onDismiss={() => dismissIncomingCall(call.callId)}
                    >
                      <Tooltip label={label()} placement="right">
                        <Button
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
                            letters={
                              channelLetters().get(call.channelId) ?? '?'
                            }
                            slim
                          />
                        </Button>
                      </Tooltip>
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
        <section class="size-full flex flex-col justify-center px-2 py-1.5">
          <header class="text-xs font-medium text-ink-muted ml-2 mb-1 whitespace-nowrap">
            <h1>Incoming calls</h1>
          </header>

          <div class="flex-1 w-full">
            <For each={activeCalls()}>
              {(call) => {
                const channel = () =>
                  channelsCtx.channelsById()[call.channelId];
                const duration = () => formatDuration(call.createdAt, nowMs());
                const label = () => {
                  const time = duration();
                  return time
                    ? `${displayName(channel())} call - ${time}`
                    : `${displayName(channel())} call`;
                };
                return (
                  <div class="w-full h-8">
                    <IncomingCallContextMenu
                      callId={call.callId}
                      channelId={call.channelId}
                      onDismiss={() => dismissIncomingCall(call.callId)}
                    >
                      <Tooltip class="w-full" label={label()} placement="right">
                        <Button
                          class={cn(
                            'flex items-center cursor-default rounded-md text-ink-extra-muted not-disabled:hover:bg-ink/3',
                            'justify-start gap-2 w-full h-8 py-1'
                          )}
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
                            letters={
                              channelLetters().get(call.channelId) ?? '?'
                            }
                            slim={false}
                          />
                          <span class="text-sm font-medium truncate">
                            {displayName(channel())}
                          </span>
                          <span class="shrink-0 size-5 flex items-center justify-center text-xs font-medium bg-success/15 text-success rounded-md ml-auto">
                            <PhoneIcon class="size-3" />
                          </span>
                        </Button>
                      </Tooltip>
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

import { useCallContextOptional } from '@channel/Call/CallContext';
import { stopCallRinger } from '@channel/Call/CallStartedNotifier';
import { joinChannelCall } from '@channel/Call/join-channel-call';
import { openChannelCallTab } from '@channel/Call/open-channel-call-tab';
import type { SidebarState } from '@components/app/app-sidebar/sidebar';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { DEV_MODE_ENV, ENABLE_CALLS } from '@core/constant/featureFlags';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import PhoneIcon from '@icon/wide-call.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import XIcon from '@phosphor/x.svg';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import { ChannelTypeEnum } from '@service-storage/client';
import { Avatar, Button, cn, Tooltip } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  type FlowComponent,
  For,
  onCleanup,
  Show,
} from 'solid-js';

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

type DebugIncomingCallOptions = {
  channelId?: string;
  callId?: string;
  createdAt?: string;
  createdBy?: string | null;
};

declare global {
  interface Window {
    macroDebugIncomingCall?: (
      options?: DebugIncomingCallOptions
    ) => IncomingCall | null;
    macroClearDebugIncomingCalls?: () => void;
  }
}

const [incomingCalls, setIncomingCalls] = createSignal<IncomingCall[]>([]);
const incomingCallTimeouts = new Map<string, number>();

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

function clearIncomingCallTimeouts() {
  for (const timeoutId of incomingCallTimeouts.values()) {
    window.clearTimeout(timeoutId);
  }
  incomingCallTimeouts.clear();
}

function dismissIncomingCall(callId: string) {
  stopCallRinger(callId);
  const timeoutId = incomingCallTimeouts.get(callId);
  if (timeoutId !== undefined) {
    window.clearTimeout(timeoutId);
    incomingCallTimeouts.delete(callId);
  }
  setIncomingCalls((calls) => calls.filter((call) => call.callId !== callId));
}

function addIncomingCall(call: IncomingCall) {
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
}

function useVisibleIncomingCalls(): Accessor<IncomingCall[]> {
  const channelsCtx = useChannelsContext();
  const callCtx = useCallContextOptional();

  return createMemo(() => {
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
}

export function useIncomingCallWidgetVisible() {
  const visibleIncomingCalls = useVisibleIncomingCalls();
  return createMemo(() => visibleIncomingCalls().length > 0);
}

export function IncomingCallWidgetEvents() {
  const callCtx = useCallContextOptional();
  const channelsCtx = useChannelsContext();
  const userId = useUserId();

  createEffect(() => {
    if (!DEV_MODE_ENV) return;

    window.macroDebugIncomingCall = (options = {}) => {
      const channelsById = channelsCtx.channelsById();
      const channelId = options.channelId ?? Object.keys(channelsById)[0];

      if (!channelId || !channelsById[channelId]) {
        console.warn(
          '[incoming-call-widget] No cached channel found for debug call',
          options
        );
        return null;
      }

      const call = {
        channelId,
        callId:
          options.callId ??
          `debug-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
        createdAt: options.createdAt ?? new Date().toISOString(),
        createdBy: options.createdBy ?? 'debug',
      };
      addIncomingCall(call);
      return call;
    };

    window.macroClearDebugIncomingCalls = () => {
      clearIncomingCallTimeouts();
      setIncomingCalls([]);
    };

    onCleanup(() => {
      delete window.macroDebugIncomingCall;
      delete window.macroClearDebugIncomingCalls;
    });
  });

  onCleanup(() => {
    clearIncomingCallTimeouts();
    setIncomingCalls([]);
  });

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

  return null;
}

export function SidebarActiveCallWidget(props: {
  sidebarState: SidebarState;
  class?: string;
}) {
  const channelsCtx = useChannelsContext();
  const userId = useUserId();
  const [nowMs, setNowMs] = createSignal(Date.now());
  const durationTimer = globalThis.setInterval(
    () => setNowMs(Date.now()),
    1000
  );
  onCleanup(() => globalThis.clearInterval(durationTimer));

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
                const duration = () => formatDuration(call.createdAt, nowMs());
                const label = () => {
                  const time = duration();
                  return time
                    ? `${displayName(channel())} call - ${time}`
                    : `${displayName(channel())} call`;
                };
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
                      onDismiss={() => dismissIncomingCall(call.callId)}
                    >
                      <div class="flex items-center gap-1.5 w-full rounded-lg p-2 text-ink-extra-muted hover:bg-ink/3">
                        <Tooltip
                          class="min-w-0 flex-1"
                          label={label()}
                          placement="right"
                        >
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
                        </Tooltip>
                        <button
                          type="button"
                          aria-label={label()}
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
                              dismissIncomingCall(call.callId);
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

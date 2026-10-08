import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { UserIcon } from '@core/component/UserIcon';
import { useAuthor, useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import ChatIcon from '@phosphor/chat-circle.svg';
import { cn, InlineCheckbox, Tooltip } from '@ui';
import type { RemoteParticipant, Track } from 'livekit-client';
import {
  createSignal,
  createUniqueId,
  For,
  type JSXElement,
  lazy,
  Show,
  Suspense,
} from 'solid-js';

import { useCallContext } from './CallContext';
import { CallControls } from './CallControls/CallControls';
import {
  CALL_PANEL_MEDIUM_NARROW_PX,
  CALL_PANEL_VERY_NARROW_PX,
} from './call-panel-breakpoints';
import { LK_TRACK_SOURCE } from './livekit-loader';
import { MutedMicrophoneBadge } from './MutedMicrophoneBadge';
import { TrackView } from './TrackView';
import { useActiveCallTeamShare } from './use-toggle-share-with-team';

const CallChat = lazy(() => import('./chat/CallChat'));

function VideoTag(props: {
  children: JSXElement;
  class?: string;
  variant?: 'default' | 'truncated';
}) {
  return (
    <div
      class={cn(
        'absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-surface/70 text-ink text-xs',
        props.variant === 'truncated' ? 'truncate max-w-[80%]' : '',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

function ParticipantTileWrapper(props: {
  isSpeaking: boolean;
  children: JSXElement;
  isConnecting?: boolean;
  class?: string;
}) {
  return (
    <div
      class={cn(
        'relative flex items-center justify-center rounded-lg overflow-hidden bg-panel min-h-30 border border-edge-muted',
        props.isSpeaking && 'ring-inset ring-2 ring-accent',
        props.isConnecting && 'animate-pulse',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

function ParticipantAvatar(props: {
  userId: string | undefined;
  fallbackName: string | undefined;
  avatarSize?: 'sm' | 'md';
}) {
  const avatarClass = () =>
    cn(
      'overflow-hidden rounded-full',
      props.avatarSize === 'sm' ? 'size-12' : 'size-20 sm:size-24'
    );

  const fallbackInitial = () => {
    const name = props.fallbackName?.trim();
    return (name ? name.charAt(0) : 'Y').toUpperCase();
  };

  return (
    <div class="flex items-center justify-center size-full p-4">
      <div class={avatarClass()}>
        <Show
          when={props.userId?.trim()}
          keyed
          fallback={
            <div
              class={cn(
                'flex size-full items-center justify-center rounded-full bg-ink-extra-muted text-surface font-semibold',
                props.avatarSize === 'sm' ? 'text-xl' : 'text-4xl'
              )}
            >
              {fallbackInitial()}
            </div>
          }
        >
          {(userId) => (
            <UserIcon
              id={userId}
              size="fill"
              suppressClick
              showTooltip={false}
            />
          )}
        </Show>
      </div>
    </div>
  );
}

function LocalParticipantTile(props: {
  isSpeaking: boolean;
  isConnecting: boolean;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  track: Track | undefined;
  userId: string | undefined;
  fallbackName: string | undefined;
  avatarSize?: 'sm' | 'md';
  class?: string;
}) {
  return (
    <ParticipantTileWrapper
      isSpeaking={props.isSpeaking}
      isConnecting={props.isConnecting}
      class={props.class}
    >
      <Show
        when={!props.isConnecting && !props.isVideoMuted}
        fallback={
          <ParticipantAvatar
            userId={props.userId}
            fallbackName={props.fallbackName}
            avatarSize={props.avatarSize}
          />
        }
      >
        <TrackView track={props.track} mirror />
      </Show>

      <MutedMicrophoneBadge muted={props.isAudioMuted} label="You are muted" />

      <Show when={props.isConnecting} fallback={<VideoTag>You</VideoTag>}>
        <div class="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-surface/70 text-ink-muted text-xs">
          Connecting...
        </div>
      </Show>
    </ParticipantTileWrapper>
  );
}

function ParticipantTile(props: { participant: RemoteParticipant }) {
  const callCtx = useCallContext();
  const macroId = () => tryMacroId(props.participant.identity);
  const displayName = () =>
    props.participant.name?.trim() ||
    (macroId() ? getDisplayName(macroId()) : 'Guest');

  const cameraTrack = () => {
    callCtx.trackVersion();
    const pub = props.participant.getTrackPublication(LK_TRACK_SOURCE.Camera);
    return pub?.isSubscribed && !pub.isMuted ? pub.track : undefined;
  };

  const isAudioMuted = () => {
    callCtx.trackVersion();
    const publication = props.participant.getTrackPublication(
      LK_TRACK_SOURCE.Microphone
    );
    return publication?.isMuted ?? true;
  };

  const isSpeaking = () => callCtx.isParticipantSpeaking(props.participant);

  return (
    <ParticipantTileWrapper isSpeaking={isSpeaking()}>
      <Show
        when={cameraTrack()}
        fallback={
          <ParticipantAvatar userId={macroId()} fallbackName={displayName()} />
        }
      >
        <TrackView track={cameraTrack()} />
      </Show>

      <MutedMicrophoneBadge
        muted={isAudioMuted()}
        label={`${displayName()} is muted`}
      />

      <VideoTag variant="truncated">{displayName()}</VideoTag>
    </ParticipantTileWrapper>
  );
}

function ScreenShareTile(props: { participant: RemoteParticipant }) {
  const callCtx = useCallContext();
  const macroId = () => tryMacroId(props.participant.identity);
  const displayName = () =>
    props.participant.name?.trim() ||
    (macroId() ? getDisplayName(macroId()) : 'Guest');
  const screenTrack = () => {
    callCtx.trackVersion();
    return props.participant.getTrackPublication(LK_TRACK_SOURCE.ScreenShare)
      ?.track;
  };

  return (
    <div class="relative size-full flex items-center justify-center rounded-lg overflow-hidden bg-panel border border-edge-muted">
      <TrackView track={screenTrack()} fit="contain" />

      <VideoTag variant="truncated">{displayName()}'s screen</VideoTag>
    </div>
  );
}

export function CallOverlay(props: {
  onLeave: () => void;
  showTeamSharing?: boolean;
  sharedWithTeam?: boolean;
  localName?: string;
  /** Shared messages require an authenticated Macro participant. */
  showChat?: boolean;
}) {
  const callCtx = useCallContext();
  const currentUserId = useUserId();
  const currentUserName = useAuthor();
  const isConnecting = () => callCtx.isConnecting();
  const teamShare = useActiveCallTeamShare();
  const sharedWithTeam = () =>
    props.sharedWithTeam ?? callCtx.isSharedWithTeam();
  const [chatOpen, setChatOpen] = createSignal(false);
  const [chatMounted, setChatMounted] = createSignal(false);
  const chatId = createUniqueId();
  let chatButton: HTMLButtonElement | undefined;
  const closeChat = () => {
    setChatOpen(false);
    chatButton?.focus();
  };
  const toggleChat = () => {
    if (chatOpen()) return closeChat();
    setChatMounted(true);
    setChatOpen(true);
  };
  const canChat = () => props.showChat !== false && !!callCtx.activeCallId();
  const teamShareLocked = () =>
    isConnecting() || !teamShare.canToggle() || teamShare.isPending();

  const splitPanel = useSplitPanel();
  const panelWidth = () => splitPanel?.panelSize.width ?? Infinity;
  const isMediumNarrow = () => panelWidth() < CALL_PANEL_MEDIUM_NARROW_PX;
  const isVeryNarrow = () => panelWidth() < CALL_PANEL_VERY_NARROW_PX;

  const participants = () =>
    Array.from(callCtx.remoteParticipants().values()).filter((p) => !p.isAgent);

  const isLocalSpeaking = () => callCtx.isLocalSpeaking();

  const localUserId = () => {
    callCtx.connectionState();
    callCtx.trackVersion();

    const identity = callCtx.room()?.localParticipant.identity?.trim();
    const macroIdentity = identity ? tryMacroId(identity) : undefined;
    const userId = currentUserId()?.trim();
    return macroIdentity ?? (userId ? tryMacroId(userId) : undefined);
  };

  const localVideoTrack = () => {
    callCtx.trackVersion();
    const r = callCtx.room();
    if (!r || callCtx.isVideoMuted()) return undefined;
    return r.localParticipant.getTrackPublication(LK_TRACK_SOURCE.Camera)
      ?.track;
  };

  const localScreenTrack = () => {
    callCtx.trackVersion();
    const r = callCtx.room();
    if (!r || !callCtx.isScreenSharing()) return undefined;
    return r.localParticipant.getTrackPublication(LK_TRACK_SOURCE.ScreenShare)
      ?.track;
  };

  const remoteScreenShares = () => {
    callCtx.trackVersion();
    return participants().filter((p) => {
      const pub = p.getTrackPublication(LK_TRACK_SOURCE.ScreenShare);
      return !!pub?.track && pub.isSubscribed && !pub.isMuted;
    });
  };

  const hasAnyScreenShare = () =>
    callCtx.isScreenSharing() || remoteScreenShares().length > 0;

  const gridCols = () => {
    const count = participants().length;
    if (count <= 1) return 'grid-cols-1';
    if (count <= 4) return 'grid-cols-2';
    return 'grid-cols-3';
  };

  return (
    <div class="flex flex-col h-full min-h-0 @container/call touch:pb-(--mobile-content-inset-bottom)">
      <div class="relative flex min-h-0 flex-1 overflow-hidden">
        <div class="flex min-w-0 flex-1 flex-col">
          {/* Screen share area */}
          <Show when={hasAnyScreenShare()}>
            <div class="flex-1 min-h-0 pt-2">
              <div class="h-full rounded-lg overflow-hidden bg-surface-2 flex items-center justify-center">
                <Show when={callCtx.isScreenSharing()}>
                  <div class="relative size-full">
                    <TrackView track={localScreenTrack()} fit="contain" />

                    <VideoTag>Your screen</VideoTag>
                  </div>
                </Show>
                <For each={remoteScreenShares()}>
                  {(participant) => (
                    <ScreenShareTile participant={participant} />
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* Participants area */}
          <div
            class={`${hasAnyScreenShare() ? 'h-45 shrink-0' : 'flex-1 min-h-0'} relative pt-2`}
          >
            <Show
              when={participants().length > 0}
              fallback={
                <LocalParticipantTile
                  class="size-full"
                  isSpeaking={isLocalSpeaking()}
                  isConnecting={isConnecting()}
                  isAudioMuted={callCtx.isAudioMuted()}
                  isVideoMuted={callCtx.isVideoMuted()}
                  track={localVideoTrack()}
                  userId={localUserId()}
                  fallbackName={
                    props.localName ||
                    callCtx.room()?.localParticipant.name ||
                    currentUserName()
                  }
                />
              }
            >
              {/* Remote participants grid */}
              <div
                class={`size-full grid ${gridCols()} gap-2 auto-rows-fr overflow-hidden`}
              >
                <For each={participants()}>
                  {(participant) => (
                    <ParticipantTile participant={participant} />
                  )}
                </For>
              </div>

              {/* Local participant PIP (Google Meet style: small, bottom-right) */}
              <div class="absolute bottom-4 right-4 w-40 aspect-video shadow-lg z-10 sm:w-48">
                <LocalParticipantTile
                  class="size-full min-h-0"
                  isSpeaking={isLocalSpeaking()}
                  isConnecting={isConnecting()}
                  isAudioMuted={callCtx.isAudioMuted()}
                  isVideoMuted={callCtx.isVideoMuted()}
                  track={localVideoTrack()}
                  userId={localUserId()}
                  fallbackName={
                    props.localName ||
                    callCtx.room()?.localParticipant.name ||
                    currentUserName()
                  }
                  avatarSize="sm"
                />
              </div>
            </Show>
          </div>
        </div>
        <Show when={canChat() && chatMounted()}>
          <Show when={callCtx.activeCallId()} keyed>
            {(callId) => (
              <Suspense>
                <CallChat
                  callId={callId}
                  id={chatId}
                  open={chatOpen()}
                  onClose={closeChat}
                />
              </Suspense>
            )}
          </Show>
        </Show>
      </div>
      {/* Settings expand over the tiles; sharing stays clear of the controls. */}
      <div class="relative flex shrink-0 flex-col items-center gap-2 py-3">
        <Show
          when={
            callCtx.activeChannelId() !== null &&
            props.showTeamSharing !== false &&
            !isVeryNarrow()
          }
        >
          <Tooltip
            placement="top"
            label={
              sharedWithTeam()
                ? "The creator's team can view the chat, transcript, and AI summary once the call ends"
                : "Let the creator's team view the chat, transcript, and AI summary once the call ends"
            }
          >
            <button
              type="button"
              onClick={() => void teamShare.toggle()}
              disabled={teamShareLocked()}
              role="checkbox"
              aria-checked={sharedWithTeam()}
              class={cn(
                'order-1 inline-flex items-center gap-2 rounded-md h-7 px-2.5 text-xs select-none',
                'border border-ink-muted/[0.08] bg-ink-muted/[0.025]',
                'text-ink-muted/70 hover:text-ink hover:bg-ink-muted/[0.06]',
                sharedWithTeam() && 'text-ink',
                teamShareLocked() && 'pointer-events-none opacity-50'
              )}
            >
              <InlineCheckbox checked={sharedWithTeam()} />
              <Show when={!isMediumNarrow()}>
                <span class="whitespace-nowrap">Share with team</span>
              </Show>
            </button>
          </Tooltip>
        </Show>
        <div class="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2 @min-[500px]/call:gap-3 @min-[500px]/call:px-3 @min-[800px]/call:grid-cols-[minmax(0,1fr)_minmax(0,36rem)_minmax(0,1fr)]">
          <div
            class="flex min-w-0 justify-center @min-[800px]/call:col-start-2"
            classList={{
              'col-span-2 @min-[800px]/call:col-span-1': !canChat(),
            }}
          >
            <CallControls onLeave={props.onLeave} />
          </div>
          <Show when={canChat()}>
            <div class="justify-self-end rounded-xl border border-edge-muted bg-panel p-1.5 shadow-sm">
              <Tooltip label={chatOpen() ? 'Close chat' : 'Open chat'}>
                <button
                  ref={chatButton}
                  type="button"
                  aria-label={chatOpen() ? 'Close chat' : 'Open chat'}
                  aria-expanded={chatOpen()}
                  aria-controls={chatId}
                  onClick={toggleChat}
                  class="flex size-10 items-center justify-center rounded-lg hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent @min-[500px]/call:size-12"
                  classList={{ 'bg-hover text-accent': chatOpen() }}
                >
                  <ChatIcon class="size-5" />
                </button>
              </Tooltip>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

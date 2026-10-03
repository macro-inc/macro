import CaretUp from '@phosphor/caret-up.svg';
import ChatCircle from '@phosphor/chat-circle.svg';
import ImageIcon from '@phosphor/image.svg';
import Microphone from '@phosphor/microphone.svg';
import MicrophoneSlash from '@phosphor/microphone-slash.svg';
import PhoneDisconnect from '@phosphor/phone-disconnect.svg';
import Screencast from '@phosphor/screencast.svg';
import VideoCamera from '@phosphor/video-camera.svg';
import VideoCameraSlash from '@phosphor/video-camera-slash.svg';
import { Button } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import type { WorkspaceComment } from '../../core/dummy-workspace';
import { homepagePeople } from '../../core/homepage-demo-people';
import { ChannelComposer } from '../email/frozen/ChannelComposer';
import { MessageRow } from '../workspace/frozen/MessageRow';
import { cameraPhoto } from './CallRecord';
import type { CallPerson } from './call-fixtures';

export type RemoteTile = {
  person: CallPerson;
  video: boolean;
  muted?: boolean;
  speaking?: boolean;
};

/** VideoTag */
function VideoTag(props: { children: JSX.Element; muted?: boolean }) {
  return (
    <div
      class="absolute bottom-1 left-1 max-w-[80%] truncate rounded bg-surface/70 px-1.5 py-0.5 text-xs"
      classList={{ 'text-ink': !props.muted, 'text-ink-muted': props.muted }}
    >
      {props.children}
    </div>
  );
}

/** MutedMicrophoneBadge */
function MutedBadge(props: { label: string }) {
  return (
    <div
      role="status"
      aria-label={props.label}
      class="pointer-events-none absolute top-2 right-2 z-10 flex size-7 items-center justify-center rounded-full border border-edge bg-surface/90 text-failure"
    >
      <MicrophoneSlash aria-hidden="true" class="size-5" />
    </div>
  );
}

/** ParticipantTileWrapper: the inset accent ring marks who is speaking. */
function Tile(props: {
  speaking?: boolean;
  connecting?: boolean;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <div
      class={`call-tile relative flex min-h-30 items-center justify-center overflow-hidden rounded-lg border border-edge-muted bg-panel ${props.class ?? ''}`}
      classList={{ 'animate-pulse': props.connecting }}
      data-speaking={props.speaking ? 'true' : undefined}
    >
      {props.children}
    </div>
  );
}

/** ParticipantAvatar, shown when a camera is off. */
function Avatar(props: { person: CallPerson; small?: boolean }) {
  return (
    <div class="flex size-full items-center justify-center p-4">
      <div
        class="overflow-hidden rounded-full"
        classList={{
          'size-12': props.small,
          'size-20 sm:size-24': !props.small,
        }}
      >
        <img
          class="size-full object-cover"
          src={homepagePeople[props.person].photo}
          alt=""
        />
      </div>
    </div>
  );
}

function Camera(props: { person: CallPerson; mirror?: boolean }) {
  return (
    <img
      class="call-camera"
      classList={{ 'call-camera-mirror': props.mirror }}
      src={cameraPhoto[props.person]}
      alt=""
    />
  );
}

function ControlButton(props: {
  label: string;
  pressed?: boolean;
  danger?: boolean;
  onClick?: () => void;
  children: JSX.Element;
}) {
  return (
    <Button
      size="icon-lg"
      variant={props.danger ? 'danger' : 'ghost'}
      label={props.label}
      tooltipPlacement="top"
      aria-pressed={props.pressed}
      onClick={() => props.onClick?.()}
      class={`call-control size-10 @sm:size-12 ${props.danger ? 'call-control-danger' : ''}`}
    >
      {props.children}
    </Button>
  );
}

function MediaGroup(props: {
  label: string;
  settings: string;
  toggleLabel: string;
  active: boolean;
  onToggle: () => void;
  children: JSX.Element;
}) {
  return (
    <div
      role="group"
      aria-label={props.label}
      class="flex items-center gap-0.5"
    >
      <ControlButton
        label={props.toggleLabel}
        pressed={props.active}
        onClick={props.onToggle}
      >
        {props.children}
      </ControlButton>
      <Button
        size="icon-md"
        variant="ghost"
        tooltipDisabled
        aria-label={props.settings}
        aria-expanded={false}
        class="call-control-caret h-10 w-5 @sm:h-12 @sm:w-8"
      >
        <CaretUp class="size-4" />
      </Button>
    </div>
  );
}

/**
 * CallOverlay inside the channel's Call tab: remote tiles in a grid, your
 * picture-in-picture, CallControlBar, the chat toggle, and Share with team.
 */
export function CallOverlayView(props: {
  remote: RemoteTile[];
  you: CallPerson;
  connecting: boolean;
  muted: boolean;
  cameraOff: boolean;
  background: boolean;
  sharing: boolean;
  sharedWithTeam: boolean;
  chatOpen: boolean;
  chat: WorkspaceComment[];
  onMute: () => void;
  onCamera: () => void;
  onBackground: () => void;
  onShareScreen: () => void;
  onShareWithTeam: () => void;
  onChat: () => void;
  onSendChat: (body: string) => void;
  onLeave: () => void;
}) {
  const columns = () =>
    props.remote.length <= 1 ? 1 : props.remote.length <= 4 ? 2 : 3;
  const local = (pip: boolean) => (
    <Tile
      class={pip ? 'size-full min-h-0' : 'size-full'}
      connecting={props.connecting}
    >
      <Show
        when={!props.connecting && !props.cameraOff}
        fallback={<Avatar person={props.you} small={pip} />}
      >
        <Camera person={props.you} mirror />
      </Show>
      <Show when={props.muted}>
        <MutedBadge label="You are muted" />
      </Show>
      <Show when={props.connecting} fallback={<VideoTag>You</VideoTag>}>
        <VideoTag muted>Connecting...</VideoTag>
      </Show>
    </Tile>
  );
  return (
    <div class="call-overlay flex h-full min-h-0 flex-col @container/call">
      <div class="relative flex min-h-0 flex-1 overflow-hidden">
        <div class="flex min-w-0 flex-1 flex-col">
          <Show when={props.sharing}>
            <div class="min-h-0 flex-1 pt-2">
              <div class="relative flex h-full items-center justify-center overflow-hidden rounded-lg bg-surface-2">
                <div class="call-screen-share" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <VideoTag>Your screen</VideoTag>
              </div>
            </div>
          </Show>
          <div
            class="relative pt-2"
            classList={{
              'h-45 shrink-0': props.sharing,
              'min-h-0 flex-1': !props.sharing,
            }}
          >
            <Show when={props.remote.length > 0} fallback={local(false)}>
              <div
                class="call-grid grid size-full auto-rows-fr gap-2 overflow-hidden"
                style={{
                  'grid-template-columns': `repeat(${columns()}, minmax(0, 1fr))`,
                }}
              >
                <For each={props.remote}>
                  {(tile) => (
                    <Tile speaking={tile.speaking}>
                      <Show
                        when={tile.video}
                        fallback={<Avatar person={tile.person} />}
                      >
                        <Camera person={tile.person} />
                      </Show>
                      <Show when={tile.muted}>
                        <MutedBadge
                          label={`${homepagePeople[tile.person].name} is muted`}
                        />
                      </Show>
                      <VideoTag>{homepagePeople[tile.person].name}</VideoTag>
                    </Tile>
                  )}
                </For>
              </div>
              <div class="call-pip absolute right-4 bottom-4 z-10 aspect-video w-40 shadow-lg sm:w-48">
                {local(true)}
              </div>
            </Show>
          </div>
        </div>
        <Show when={props.chatOpen}>
          <aside aria-label="Call chat" class="call-chat-panel">
            <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
              <Show
                when={props.chat.length}
                fallback={
                  <p class="px-1 text-sm text-ink-muted">
                    Start the conversation. Messages stay with this call.
                  </p>
                }
              >
                <For each={props.chat}>
                  {(message) => <MessageRow message={message} />}
                </For>
              </Show>
            </div>
            <div class="shrink-0 p-3">
              <ChannelComposer
                label="Message this call"
                placeholder="Message this call…"
                onSend={props.onSendChat}
              />
            </div>
          </aside>
        </Show>
      </div>
      <div class="relative flex shrink-0 flex-col items-center gap-2 py-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={props.sharedWithTeam}
          title={
            props.sharedWithTeam
              ? "The creator's team can view the chat, transcript, and AI summary once the call ends"
              : "Let the creator's team view the chat, transcript, and AI summary once the call ends"
          }
          class="call-team-share order-1"
          onClick={() => props.onShareWithTeam()}
        >
          <span class="call-checkbox" data-checked={props.sharedWithTeam}>
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="m2.5 6.2 2.3 2.3 4.7-5" />
            </svg>
          </span>
          <span class="whitespace-nowrap">Share with team</span>
        </button>
        <div class="call-controls-row">
          <div class="call-controls-center">
            <div
              data-call-controls
              class="@container relative z-20 w-full max-w-xl"
            >
              <div class="mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-1 rounded-xl bg-menu-glass p-1.5 text-ink glass @sm:gap-2">
                <MediaGroup
                  label="Microphone controls"
                  settings="Audio settings"
                  toggleLabel={
                    props.muted ? 'Unmute microphone' : 'Mute microphone'
                  }
                  active={!props.muted}
                  onToggle={props.onMute}
                >
                  <Show when={props.muted} fallback={<Microphone />}>
                    <MicrophoneSlash />
                  </Show>
                </MediaGroup>
                <MediaGroup
                  label="Camera controls"
                  settings="Camera settings"
                  toggleLabel={
                    props.cameraOff ? 'Turn on camera' : 'Turn off camera'
                  }
                  active={!props.cameraOff}
                  onToggle={props.onCamera}
                >
                  <Show when={props.cameraOff} fallback={<VideoCamera />}>
                    <VideoCameraSlash />
                  </Show>
                </MediaGroup>
                <MediaGroup
                  label="Background controls"
                  settings="Background settings"
                  toggleLabel={
                    props.background
                      ? 'Turn off background'
                      : 'Turn on background'
                  }
                  active={props.background}
                  onToggle={props.onBackground}
                >
                  <ImageIcon />
                </MediaGroup>
                <ControlButton
                  label={props.sharing ? 'Stop sharing screen' : 'Share screen'}
                  pressed={props.sharing}
                  onClick={props.onShareScreen}
                >
                  <Screencast />
                </ControlButton>
                <ControlButton
                  label="Leave call"
                  danger
                  onClick={props.onLeave}
                >
                  <PhoneDisconnect />
                </ControlButton>
              </div>
            </div>
          </div>
          <div class="call-chat-toggle justify-self-end rounded-xl border border-edge-muted bg-panel p-1.5 shadow-sm">
            <button
              type="button"
              aria-label={props.chatOpen ? 'Close chat' : 'Open chat'}
              aria-expanded={props.chatOpen}
              title={props.chatOpen ? 'Close chat' : 'Open chat'}
              onClick={() => props.onChat()}
              class="flex size-10 items-center justify-center rounded-lg hover:bg-hover @min-[500px]/call:size-12"
              classList={{ 'bg-hover text-accent': props.chatOpen }}
            >
              <ChatCircle class="size-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

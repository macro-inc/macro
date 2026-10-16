import CaretUp from '@phosphor/caret-up.svg';
import ChatCircle from '@phosphor/chat-circle.svg';
import ImageIcon from '@phosphor/image.svg';
import Microphone from '@phosphor/microphone.svg';
import MicrophoneSlash from '@phosphor/microphone-slash.svg';
import PhoneDisconnect from '@phosphor/phone-disconnect.svg';
import Screencast from '@phosphor/screencast.svg';
import VideoCameraSlash from '@phosphor/video-camera-slash.svg';
import { Button } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import type { WorkspaceComment } from '../../core/dummy-workspace';
import { homepagePeople } from '../../core/homepage-demo-people';
import { ChannelComposer } from '../email/frozen/ChannelComposer';
import { MessageRow } from '../workspace/frozen/MessageRow';
import type { CallPerson } from './call-fixtures';

export type RemoteTile = {
  person: CallPerson;
  muted?: boolean;
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

/** Camera-off ParticipantTileWrapper; no simulated speaker activity. */
function Tile(props: {
  connecting?: boolean;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <div
      class={`call-tile relative flex min-h-30 items-center justify-center overflow-hidden rounded-lg border border-edge-muted bg-panel ${props.class ?? ''}`}
      classList={{ 'animate-pulse': props.connecting }}
    >
      {props.children}
    </div>
  );
}

/** ParticipantAvatar, shown when a camera is off. */
function Avatar(props: { person: CallPerson }) {
  return (
    <div class="flex size-full items-center justify-center p-4">
      <div class="size-20 overflow-hidden rounded-full sm:size-24">
        <img
          class="size-full object-cover"
          src={homepagePeople[props.person].photo}
          alt=""
        />
      </div>
    </div>
  );
}

function ControlButton(props: {
  label: string;
  pressed?: boolean;
  danger?: boolean;
  disabled?: boolean;
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
      disabled={props.disabled}
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
  onToggle?: () => void;
  disabled?: boolean;
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
        disabled={props.disabled}
      >
        {props.children}
      </ControlButton>
      <Button
        size="icon-md"
        variant="ghost"
        tooltipDisabled
        aria-label={props.settings}
        aria-expanded={false}
        disabled
        class="call-control-caret h-10 w-5 @sm:h-12 @sm:w-8"
      >
        <CaretUp class="size-4" />
      </Button>
    </div>
  );
}

/**
 * Marketing call view: all participants, including you, share the same grid.
 * Keeps the call controls and chat alongside camera-off participant tiles. Camera-off tiles
 * use the app’s participant avatars; profile photos never stand in for video.
 */
export function CallOverlayView(props: {
  remote: RemoteTile[];
  you: CallPerson;
  connecting: boolean;
  muted: boolean;
  chatOpen: boolean;
  chat: WorkspaceComment[];
  onMute: () => void;
  onChat: () => void;
  onSendChat: (body: string) => void;
  onLeave: () => void;
}) {
  const count = () => props.remote.length + 1;
  const columns = () => (count() <= 1 ? 1 : count() <= 4 ? 2 : 3);
  const local = () => (
    <Tile connecting={props.connecting}>
      <Avatar person={props.you} />
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
          <div class="call-participant-area relative min-h-0 flex-1 pt-2">
            <div
              class="call-grid grid size-full auto-rows-fr gap-2 overflow-hidden"
              data-count={count()}
              style={{
                'grid-template-columns': `repeat(${columns()}, minmax(0, 1fr))`,
              }}
            >
              <For each={props.remote}>
                {(tile) => (
                  <Tile>
                    <Avatar person={tile.person} />
                    <Show when={tile.muted}>
                      <MutedBadge
                        label={`${homepagePeople[tile.person].name} is muted`}
                      />
                    </Show>
                    <VideoTag>{homepagePeople[tile.person].name}</VideoTag>
                  </Tile>
                )}
              </For>
              {local()}
            </div>
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
                  toggleLabel="Turn on camera"
                  active={false}
                  disabled
                >
                  <VideoCameraSlash />
                </MediaGroup>
                <MediaGroup
                  label="Background controls"
                  settings="Background settings"
                  toggleLabel="Turn on background"
                  active={false}
                  disabled
                >
                  <ImageIcon />
                </MediaGroup>
                <ControlButton label="Share screen" disabled>
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

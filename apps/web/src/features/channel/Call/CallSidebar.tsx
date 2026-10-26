import { SidePanel } from '@components/app/side-panel';
import { UserIcon } from '@core/component/UserIcon';
import { getDisplayName, tryMacroId } from '@core/user';
import ChatIcon from '@phosphor/chat-circle.svg';
import MicrophoneSlash from '@phosphor/microphone-slash.svg';
import UsersIcon from '@phosphor/users.svg';
import XIcon from '@phosphor/x.svg';
import { Button, Tabs, ToggleSwitch } from '@ui';
import type { RemoteParticipant } from 'livekit-client';
import { For, type JSX, Show } from 'solid-js';
import { useCallContext } from './CallContext';
import { LK_TRACK_SOURCE } from './livekit-loader';

export type CallTeamSharing = {
  shared: boolean;
  disabled: boolean;
  onToggle: () => void;
};

export type CallSidebarTab = 'people' | 'chat';

/**
 * The call sidebar's People sections. They register with the nearest
 * `SidePanel.Root` and render wherever its `SidePanel.Outlet` is mounted.
 */
export function CallPeopleSections(props: {
  localUserId?: string;
  localName: string;
  participants: RemoteParticipant[];
  teamSharing?: CallTeamSharing;
}) {
  return (
    <>
      <SidePanel.Section
        id="call-people"
        order={10}
        defaultOpen
        title={
          <SidePanel.CountTitle
            label="People"
            count={props.participants.length + 1}
          />
        }
      >
        <ul class="flex flex-col gap-0.5">
          <LocalPersonRow userId={props.localUserId} name={props.localName} />
          <For each={props.participants}>
            {(participant) => <RemotePersonRow participant={participant} />}
          </For>
        </ul>
      </SidePanel.Section>
      <Show when={props.teamSharing}>
        {(sharing) => (
          <SidePanel.Section
            id="call-sharing"
            title="Sharing"
            order={20}
            defaultOpen
          >
            <div class="flex items-start gap-3">
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="text-sm text-ink">Share with team</span>
                <span class="text-xs text-ink-muted">
                  The creator’s team can view the chat, transcript, and AI
                  summary once the call ends.
                </span>
              </div>
              <ToggleSwitch
                size="md"
                checked={sharing().shared}
                disabled={sharing().disabled}
                onChange={sharing().onToggle}
                label="Share with team"
                labelClass="sr-only"
              />
            </div>
          </SidePanel.Section>
        )}
      </Show>
    </>
  );
}

function PersonRow(props: {
  userId?: string;
  name: string;
  you?: boolean;
  muted: boolean;
}) {
  return (
    <li class="flex h-9 items-center gap-2 rounded-lg px-1">
      <div class="size-6 shrink-0 overflow-hidden rounded-full">
        <Show
          when={props.userId}
          keyed
          fallback={
            <div class="flex size-full items-center justify-center bg-ink-extra-muted text-xs font-semibold text-surface">
              {(props.name.trim().charAt(0) || '?').toUpperCase()}
            </div>
          }
        >
          {(id) => (
            <UserIcon id={id} size="fill" suppressClick showTooltip={false} />
          )}
        </Show>
      </div>
      <span class="min-w-0 flex-1 truncate text-sm text-ink">
        {props.name}
        <Show when={props.you}>
          <span class="text-ink-muted"> (you)</span>
        </Show>
      </span>
      <Show when={props.muted}>
        <MicrophoneSlash
          role="img"
          aria-label="Muted"
          class="size-4 shrink-0 text-ink-muted"
        />
      </Show>
    </li>
  );
}

function LocalPersonRow(props: { userId?: string; name: string }) {
  const call = useCallContext();
  return (
    <PersonRow
      userId={props.userId}
      name={props.name}
      you
      muted={call.isAudioMuted()}
    />
  );
}

function RemotePersonRow(props: { participant: RemoteParticipant }) {
  const call = useCallContext();
  const macroId = () => tryMacroId(props.participant.identity);
  const name = () =>
    props.participant.name?.trim() ||
    (macroId() ? getDisplayName(macroId()) : 'Guest');
  const muted = () => {
    call.trackVersion();
    return (
      props.participant.getTrackPublication(LK_TRACK_SOURCE.Microphone)
        ?.isMuted ?? true
    );
  };
  return <PersonRow userId={macroId()} name={name()} muted={muted()} />;
}

/**
 * The call sidebar, with People and Chat tabs: docked beside the call on wide
 * layouts, over it on narrow ones.
 */
export function CallSidebar(props: {
  id: string;
  open: boolean;
  tab: CallSidebarTab;
  showChat: boolean;
  onTabChange: (tab: CallSidebarTab) => void;
  onClose: () => void;
  children: JSX.Element;
}) {
  return (
    <aside
      id={props.id}
      aria-label="Call sidebar"
      hidden={!props.open}
      class="absolute inset-y-0 right-0 z-20 w-full max-w-90 min-h-0 flex-col bg-surface @min-[800px]/call:static @min-[800px]/call:w-90 @min-[800px]/call:shrink-0"
      classList={{ flex: props.open }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
      }}
    >
      <div class="flex shrink-0 items-center gap-2 px-3 pt-3">
        <Show
          when={props.showChat}
          fallback={<h2 class="px-1 text-sm font-medium text-ink">People</h2>}
        >
          <Tabs
            aria-label="Call sidebar"
            size="md"
            touch="pills"
            options={[
              { value: 'people', label: 'People', icon: UsersIcon },
              { value: 'chat', label: 'Chat', icon: ChatIcon },
            ]}
            value={props.tab}
            onChange={props.onTabChange}
          />
        </Show>
        <Button
          class="ml-auto"
          variant="ghost"
          size="icon-md"
          label="Close sidebar"
          onClick={props.onClose}
        >
          <XIcon />
        </Button>
      </div>
      {props.children}
    </aside>
  );
}

/** The People tab: the registered sections, kept mounted while hidden. */
export function CallPeoplePane(props: { open: boolean }) {
  return (
    <div
      hidden={!props.open}
      class="min-h-0 flex-1 flex-col"
      classList={{ flex: props.open }}
    >
      <SidePanel.Outlet />
    </div>
  );
}

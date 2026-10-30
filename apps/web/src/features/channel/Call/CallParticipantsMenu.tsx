import { formatLocale, t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { UserIcon } from '@core/component/UserIcon';
import { useAuthor, useUserId } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { getDisplayName, tryMacroId } from '@core/user';
import Microphone from '@icon/system/regular/microphone.svg';
import MicrophoneSlash from '@icon/system/regular/microphone-slash.svg';
import Users from '@icon/system/regular/users.svg';
import VideoCamera from '@icon/system/regular/video-camera.svg';
import VideoCameraSlash from '@icon/system/regular/video-camera-slash.svg';
import { Popover } from '@kobalte/core/popover';
import { Button, type ButtonProps, Layer } from '@ui';
import type { RemoteParticipant } from 'livekit-client';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { useCallContext } from './CallContext';
import { LK_TRACK_SOURCE } from './livekit-loader';

function ParticipantRow(props: {
  name: string;
  userId?: string;
  local?: boolean;
  speaking: boolean;
  muted: boolean;
  videoEnabled: boolean;
}) {
  return (
    <li class="flex min-h-14 items-center gap-3 px-3 py-2">
      <div class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-hover text-sm font-medium">
        <Show when={props.userId} fallback={props.name.charAt(0).toUpperCase()}>
          {(id) => (
            <UserIcon id={id()} size="fill" suppressClick showTooltip={false} />
          )}
        </Show>
      </div>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm" title={props.name}>
          {props.local
            ? t('calls.localParticipant', { name: props.name })
            : props.name}
        </p>
        <Show when={props.speaking}>
          <p class="text-xs text-accent">{t('calls.speaking')}</p>
        </Show>
      </div>
      <span
        class="shrink-0 text-ink-muted"
        role="img"
        aria-label={
          props.muted ? t('calls.microphoneOff') : t('calls.microphoneOn')
        }
      >
        <Show when={props.muted} fallback={<Microphone class="size-4" />}>
          <MicrophoneSlash class="size-4" />
        </Show>
      </span>
      <span
        class="shrink-0 text-ink-muted"
        role="img"
        aria-label={
          props.videoEnabled ? t('calls.cameraOn') : t('calls.cameraOff')
        }
      >
        <Show
          when={props.videoEnabled}
          fallback={<VideoCameraSlash class="size-4" />}
        >
          <VideoCamera class="size-4" />
        </Show>
      </span>
    </li>
  );
}

function RemoteParticipantRow(props: { participant: RemoteParticipant }) {
  const call = useCallContext();
  const userId = () => tryMacroId(props.participant.identity);
  const name = () =>
    props.participant.name?.trim() ||
    (userId() ? getDisplayName(userId()) : t('calls.guest'));
  const publication = (
    source: typeof LK_TRACK_SOURCE.Camera | typeof LK_TRACK_SOURCE.Microphone
  ) => {
    call.trackVersion();
    return props.participant.getTrackPublication(source);
  };
  return (
    <ParticipantRow
      name={name()}
      userId={userId()}
      speaking={call.isParticipantSpeaking(props.participant)}
      muted={publication(LK_TRACK_SOURCE.Microphone)?.isMuted ?? true}
      videoEnabled={publication(LK_TRACK_SOURCE.Camera)?.isMuted === false}
    />
  );
}

/** Shows current human attendees from the live room, not channel membership. */
export function CallParticipantsMenu(props: { localName?: string }) {
  const call = useCallContext();
  const author = useAuthor();
  const currentUserId = useUserId();
  const [open, setOpen] = createSignal(false);
  const participants = createMemo(() =>
    Array.from(call.remoteParticipants().values()).filter(
      (participant) => !participant.isAgent
    )
  );
  const count = () => participants().length + 1;
  const localName = () =>
    props.localName?.trim() ||
    call.room()?.localParticipant.name?.trim() ||
    author() ||
    t('calls.you');
  const localUserId = () => {
    call.connectionState();
    call.trackVersion();
    return (
      tryMacroId(call.room()?.localParticipant.identity ?? '') ??
      tryMacroId(currentUserId() ?? '')
    );
  };
  const Trigger = (triggerProps: ButtonProps) => (
    <Button
      {...triggerProps}
      variant="ghost"
      size={isMobile() ? 'lg' : 'sm'}
      aria-label={t('calls.participantsCount', { count: count() })}
      tooltip={t('calls.participants')}
    >
      <Users class="size-4 mobile:size-5" />
      <span>{count().toLocaleString(formatLocale())}</span>
    </Button>
  );
  const List = () => (
    <ul aria-label={t('calls.inCallParticipants')} class="ph-no-capture">
      <ParticipantRow
        name={localName()}
        userId={localUserId()}
        local
        speaking={call.isLocalSpeaking()}
        muted={call.isAudioMuted()}
        videoEnabled={!call.isVideoMuted()}
      />
      <For each={participants()}>
        {(participant) => <RemoteParticipantRow participant={participant} />}
      </For>
    </ul>
  );

  return (
    <HeaderIsland class="px-1">
      <Show
        when={isMobile()}
        fallback={
          <Popover
            open={open()}
            onOpenChange={setOpen}
            placement="bottom-end"
            gutter={8}
          >
            <Popover.Trigger as={Trigger} />
            <Popover.Portal>
              <Layer depth={3}>
                <Popover.Content class="menu-surface z-modal min-w-80 max-w-[calc(100vw-2rem)] p-1">
                  <Popover.Title class="px-3 py-2 text-sm font-medium">
                    {t('calls.participantsCount', { count: count() })}
                  </Popover.Title>
                  <div class="max-h-80 overflow-y-auto">
                    <List />
                  </div>
                </Popover.Content>
              </Layer>
            </Popover.Portal>
          </Popover>
        }
      >
        <MobileDrawer
          open={open()}
          onOpenChange={setOpen}
          restoreFocus
          noOutsidePointerEvents
        >
          <Trigger
            aria-haspopup="dialog"
            aria-expanded={open()}
            onClick={() => setOpen(!open())}
          />
          <MobileDrawer.Portal>
            <MobileDrawer.Overlay />
            <MobileDrawer.Content>
              <MobileDrawer.Handle />
              <MobileDrawer.Title class="px-6 pb-3 text-sm font-medium">
                {t('calls.participantsCount', { count: count() })}
              </MobileDrawer.Title>
              <MobileDrawer.ScrollBody>
                <List />
              </MobileDrawer.ScrollBody>
            </MobileDrawer.Content>
          </MobileDrawer.Portal>
        </MobileDrawer>
      </Show>
    </HeaderIsland>
  );
}

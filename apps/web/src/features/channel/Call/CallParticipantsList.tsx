import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import { useAuthor, useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import Microphone from '@icon/system/regular/microphone.svg';
import MicrophoneSlash from '@icon/system/regular/microphone-slash.svg';
import VideoCamera from '@icon/system/regular/video-camera.svg';
import VideoCameraSlash from '@icon/system/regular/video-camera-slash.svg';
import { Avatar, Badge, cn } from '@ui';
import type { RemoteParticipant } from 'livekit-client';
import { createMemo, For, Show } from 'solid-js';
import { useCallContext } from './CallContext';
import { isProgramParticipant } from './is-program-participant';
import { LK_TRACK_SOURCE } from './livekit-loader';

function ParticipantRow(props: {
  name: string;
  userId?: string;
  local?: boolean;
  compact?: boolean;
  isProgram: boolean;
  speaking: boolean;
  muted: boolean;
  videoEnabled: boolean;
}) {
  return (
    <li
      class={cn(
        'flex items-center gap-3 px-3',
        props.compact ? 'min-h-9 py-1' : 'min-h-14 py-2'
      )}
    >
      <div
        class={cn(
          'shrink-0 rounded-full',
          props.compact ? 'size-6' : 'size-8',
          props.speaking && 'ring-2 ring-success'
        )}
      >
        <Show
          when={props.userId}
          fallback={
            <Avatar size="fill">
              <Avatar.Fallback>
                {props.name.charAt(0).toUpperCase()}
              </Avatar.Fallback>
            </Avatar>
          }
        >
          {(id) => <UserIcon id={id()} size="fill" suppressClick />}
        </Show>
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-1">
          <p class="min-w-0 truncate text-sm" title={props.name}>
            {props.local
              ? t('calls.localParticipant', { name: props.name })
              : props.name}
          </p>
          <Show when={props.isProgram}>
            <Badge variant="secondary" size="xs">
              {t('calls.agent')}
            </Badge>
          </Show>
        </div>
        <Show when={props.speaking && !props.compact}>
          <p class="text-xs text-accent">{t('calls.speaking')}</p>
        </Show>
      </div>
      <span
        class={cn('shrink-0', props.muted ? 'text-failure' : 'text-ink-muted')}
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
        class={cn(
          'shrink-0',
          props.videoEnabled ? 'text-ink-muted' : 'text-failure'
        )}
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

function RemoteParticipantRow(props: {
  participant: RemoteParticipant;
  compact?: boolean;
}) {
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
      compact={props.compact}
      userId={userId()}
      isProgram={isProgramParticipant(props.participant.attributes)}
      speaking={call.isParticipantSpeaking(props.participant)}
      muted={publication(LK_TRACK_SOURCE.Microphone)?.isMuted ?? true}
      videoEnabled={publication(LK_TRACK_SOURCE.Camera)?.isMuted === false}
    />
  );
}

/** Shows current human attendees from the live room, not channel membership. */
export function CallParticipantsList(props: {
  localName?: string;
  compact?: boolean;
}) {
  const call = useCallContext();
  const author = useAuthor();
  const currentUserId = useUserId();
  const participants = createMemo(() =>
    Array.from(call.remoteParticipants().values()).filter(
      (participant) => !participant.isAgent
    )
  );
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
  return (
    <ul aria-label={t('calls.inCallParticipants')} class="ph-no-capture">
      <ParticipantRow
        name={localName()}
        compact={props.compact}
        userId={localUserId()}
        local
        isProgram={isProgramParticipant(
          call.room()?.localParticipant.attributes
        )}
        speaking={call.isLocalSpeaking()}
        muted={call.isAudioMuted()}
        videoEnabled={!call.isVideoMuted()}
      />
      <For each={participants()}>
        {(participant) => (
          <RemoteParticipantRow
            participant={participant}
            compact={props.compact}
          />
        )}
      </For>
    </ul>
  );
}

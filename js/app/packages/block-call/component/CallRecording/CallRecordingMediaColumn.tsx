import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import type { Accessor, Setter } from 'solid-js';
import { Show } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { CallRecordingParticipantsSection } from './CallRecordingParticipants';
import { CallRecordingVideo } from './CallRecordingVideo';

export type CallRecordingTimeUpdateSource = 'playback' | 'seeking' | 'seeked';

/** Left column: recording video, fallbacks, and wide-mode participants slide. */
export function CallRecordingMediaColumn(props: {
  record: Accessor<CallRecord>;
  hasTranscripts: Accessor<boolean>;
  isStacked: Accessor<boolean>;
  participantsOpen: Accessor<boolean>;
  suppressWideParticipantsMotion: Accessor<boolean>;
  participantsContentHeight: Accessor<number>;
  setParticipantsContentRef: Setter<HTMLDivElement | undefined>;
  onTimeUpdate: (
    seconds: number,
    source: CallRecordingTimeUpdateSource
  ) => void;
  setVideoRef: Setter<HTMLVideoElement | undefined>;
}) {
  return (
    <div class="flex min-h-0 min-w-0 flex-col overflow-hidden @[860px]:min-h-0 @[860px]:min-w-0 @[860px]:overflow-hidden">
      <Show when={props.record().recordingUrl}>
        {(url) => (
          <div class="min-h-0 flex-1 overflow-hidden">
            <CallRecordingVideo
              url={url()}
              onTimeUpdate={props.onTimeUpdate}
              setVideoRef={props.setVideoRef}
            />
          </div>
        )}
      </Show>
      <Show when={!props.record().recordingUrl}>
        <Show
          when={props.hasTranscripts()}
          fallback={
            <div class="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-sm text-ink-faint">
              No recording or transcript available.
            </div>
          }
        >
          <div class="flex min-h-[120px] flex-1 items-center justify-center px-4 text-center text-sm text-ink-faint">
            No video recording for this call.
          </div>
        </Show>
      </Show>

      <div
        class={cn(
          'overflow-hidden @[860px]:block',
          props.isStacked() ? 'hidden' : 'block',
          props.suppressWideParticipantsMotion()
            ? 'transition-none'
            : 'transition-[max-height] duration-300 ease-out'
        )}
        style={{
          'max-height': props.participantsOpen()
            ? `${props.participantsContentHeight()}px`
            : '0px',
        }}
      >
        <div
          ref={props.setParticipantsContentRef}
          class={cn(
            props.suppressWideParticipantsMotion()
              ? 'transition-none'
              : 'transition-[transform,opacity] duration-300 ease-out will-change-transform',
            props.participantsOpen()
              ? 'translate-y-0 opacity-100'
              : 'translate-y-4 opacity-0 pointer-events-none'
          )}
        >
          <CallRecordingParticipantsSection record={props.record} />
        </div>
      </div>
    </div>
  );
}

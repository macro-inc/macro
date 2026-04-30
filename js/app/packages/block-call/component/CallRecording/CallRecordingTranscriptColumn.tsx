import Subtitles from '@phosphor-icons/core/assets/regular/subtitles.svg';
import UsersThree from '@phosphor-icons/core/assets/regular/users-three.svg';
import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import type { Accessor } from 'solid-js';
import { Show } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { CallTranscript } from '../CallTranscript';
import { CallRecordingParticipantsSection } from './CallRecordingParticipants';
import { CallRecordingSectionShell } from './CallRecordingSectionShell';

/** Right column: transcript shell + stacked participants accordion. */
export function CallRecordingTranscriptColumn(props: {
  record: Accessor<CallRecord>;
  hasTranscripts: Accessor<boolean>;
  isStacked: Accessor<boolean>;
  transcriptOpen: Accessor<boolean>;
  participantsOpen: Accessor<boolean>;
  activeSequenceNum: Accessor<number | null>;
  timelineStartMs: Accessor<number | null>;
  videoSeekGeneration: Accessor<number>;
  onToggleTranscript: () => void;
  onToggleParticipants: () => void;
  onSeekToSeconds: (seconds: number) => void;
}) {
  return (
    <div
      class={cn(
        'relative min-h-0 min-w-0 overflow-hidden border-edge-muted/50',
        props.isStacked()
          ? 'flex min-h-0 min-w-0 flex-col'
          : 'flex min-h-0 min-w-0 flex-col border-t @[860px]:h-full @[860px]:min-h-0 @[860px]:border-t-0 @[860px]:border-l'
      )}
    >
      <Show
        when={props.hasTranscripts()}
        fallback={
          <div class="flex h-full min-h-0 w-full min-w-0 flex-1 items-center justify-center px-4 py-10 text-center text-sm text-ink-muted">
            No transcripts for this call.
          </div>
        }
      >
        <div
          class={cn(
            'min-h-0 min-w-0 flex-1',
            props.isStacked()
              ? 'flex flex-col'
              : 'flex min-h-0 flex-1 flex-col @[860px]:h-full @[860px]:min-h-0 @[860px]:min-w-[40cqw]'
          )}
        >
          <CallRecordingSectionShell
            title="Transcript"
            icon={<Subtitles class="size-4 text-ink shrink-0" />}
            open={props.transcriptOpen()}
            accordion={props.isStacked()}
            accordionOpenMaxVh={52}
            onToggle={props.isStacked() ? props.onToggleTranscript : undefined}
            class={cn(!props.isStacked() && 'border-t-0')}
          >
            <CallTranscript
              transcript={props.record().transcript}
              channelId={props.record().channelId}
              timelineStartMs={props.timelineStartMs()}
              activeSequenceNum={props.activeSequenceNum()}
              videoSeekGeneration={props.videoSeekGeneration()}
              onSeekToSeconds={props.onSeekToSeconds}
              hideHeader
            />
          </CallRecordingSectionShell>

          <Show when={props.isStacked()}>
            <CallRecordingSectionShell
              title="Participants"
              icon={<UsersThree class="size-4 text-ink shrink-0" />}
              open={props.participantsOpen()}
              accordion
              accordionOpenMaxVh={38}
              onToggle={props.onToggleParticipants}
            >
              <CallRecordingParticipantsSection
                record={props.record}
                withShell={false}
              />
            </CallRecordingSectionShell>
          </Show>
        </div>
      </Show>
    </div>
  );
}

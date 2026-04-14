import type { CallRecordTranscriptSegment } from '@service-storage/generated/schemas/callRecordTranscriptSegment';
import { tryMacroId, useDisplayName } from '@core/user';
import { For } from 'solid-js';

function TranscriptSegment(props: { segment: CallRecordTranscriptSegment }) {
  const macroId = () => tryMacroId(props.segment.speakerId);
  const [displayName] = useDisplayName(macroId());

  return (
    <div class="flex gap-2 py-1.5 px-3">
      <span class="font-medium text-ink shrink-0">{displayName()}</span>
      <span class="text-ink-muted">{props.segment.content}</span>
    </div>
  );
}

export function CallTranscript(props: {
  transcript: CallRecordTranscriptSegment[];
}) {
  const sorted = () =>
    [...props.transcript].sort((a, b) => a.sequenceNum - b.sequenceNum);

  return (
    <div class="flex flex-col divide-y divide-edge">
      <For each={sorted()}>
        {(segment) => <TranscriptSegment segment={segment} />}
      </For>
    </div>
  );
}

import type { CallRecordTranscriptSegment } from '@service-storage/generated/schemas/callRecordTranscriptSegment';
import { tryMacroId, useDisplayName } from '@core/user';
import { UserIcon } from '@core/component/UserIcon';
import { formatDate } from '@core/util/date';
import { createMemo, For, Show } from 'solid-js';

// Match the channel message grouping window (5 minutes).
const GROUPING_WINDOW_MS = 5 * 60 * 1000;

type SegmentItem = {
  segment: CallRecordTranscriptSegment;
  groupedWithPrevious: boolean;
};

function shouldGroupWithPrevious(
  current: CallRecordTranscriptSegment,
  previous: CallRecordTranscriptSegment | undefined
): boolean {
  if (!previous) return false;
  if (current.speakerId !== previous.speakerId) return false;
  const gap =
    new Date(current.startedAt).getTime() -
    new Date(previous.startedAt).getTime();
  return gap >= 0 && gap <= GROUPING_WINDOW_MS;
}

function TranscriptSegmentRow(props: { segment: CallRecordTranscriptSegment }) {
  const macroId = () => tryMacroId(props.segment.speakerId);
  const [displayName] = useDisplayName(macroId());

  return (
    <div
      class="grid min-w-0 items-start gap-x-2 pr-2 pl-(--message-padding-x) pt-(--regular-message-padding-t)"
      style={{
        'grid-template-columns': 'var(--user-icon-width) minmax(0, 1fr)',
      }}
    >
      <div class="flex-shrink-0 size-[var(--user-icon-width)]">
        <UserIcon id={props.segment.speakerId} size="fill" />
      </div>
      <div class="flex flex-col min-w-0">
        <div class="flex items-center gap-1 min-w-0">
          <span class="text-sm font-medium text-ink truncate">
            {displayName()}
          </span>
          <span class="ml-auto text-xs text-ink-placeholder">
            {formatDate(props.segment.startedAt, { showTime: true })}
          </span>
        </div>
        <div class="whitespace-pre-wrap break-words text-sm text-ink">
          {props.segment.content}
        </div>
      </div>
    </div>
  );
}

function GroupedTranscriptSegmentRow(props: {
  segment: CallRecordTranscriptSegment;
}) {
  return (
    <div
      class="grid min-w-0 items-start gap-x-2 pr-2 pl-(--message-padding-x)"
      style={{
        'grid-template-columns': 'var(--user-icon-width) minmax(0, 1fr)',
      }}
    >
      <div aria-hidden="true" />
      <div class="whitespace-pre-wrap break-words text-sm text-ink">
        {props.segment.content}
      </div>
    </div>
  );
}

export function CallTranscript(props: {
  transcript: CallRecordTranscriptSegment[];
}) {
  const items = createMemo<SegmentItem[]>(() => {
    const sorted = [...props.transcript].sort(
      (a, b) => a.sequenceNum - b.sequenceNum
    );
    return sorted.map((segment, index) => ({
      segment,
      groupedWithPrevious: shouldGroupWithPrevious(segment, sorted[index - 1]),
    }));
  });

  return (
    <div class="flex flex-col py-2">
      <For each={items()}>
        {(item) => (
          <Show
            when={item.groupedWithPrevious}
            fallback={<TranscriptSegmentRow segment={item.segment} />}
          >
            <GroupedTranscriptSegmentRow segment={item.segment} />
          </Show>
        )}
      </For>
    </div>
  );
}

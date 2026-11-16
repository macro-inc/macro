import type { MessageData } from '@core/messages/types';
import type { CallRecordTranscriptSegment } from '@service-storage/generated/schemas/callRecordTranscriptSegment';
import { createMemo } from 'solid-js';
import { getSegmentVideoSeconds } from '../component/transcript-playback';
import { messageVideoSeconds } from '../core/recording-chat';

type TimelineRow =
  | {
      kind: 'transcript';
      key: string;
      seconds: number | null;
      segment: CallRecordTranscriptSegment;
    }
  | { kind: 'chat'; key: string; seconds: number; message: MessageData };

/** Merge recorded speech and discussion into one stable playback timeline. */
export function createTranscriptTimeline(options: {
  transcript: CallRecordTranscriptSegment[];
  messages?: MessageData[];
  timelineStartMs: number | null;
  durationSeconds?: number;
}) {
  const timeline = createMemo<TimelineRow[]>(() => {
    const segments: TimelineRow[] = [...options.transcript]
      .sort((a, b) => a.sequenceNum - b.sequenceNum)
      .map((segment) => ({
        kind: 'transcript',
        key: segment.transcriptId,
        segment,
        seconds: getSegmentVideoSeconds(segment, options.timelineStartMs),
      }));
    const messages: TimelineRow[] = (options.messages ?? []).flatMap(
      (message) => {
        const seconds = messageVideoSeconds(
          message.created_at,
          options.timelineStartMs,
          options.durationSeconds
        );
        return seconds === null
          ? []
          : [{ kind: 'chat' as const, key: message.id, seconds, message }];
      }
    );
    return [...segments, ...messages].sort(
      (a, b) => (a.seconds ?? Infinity) - (b.seconds ?? Infinity)
    );
  });
  return timeline;
}

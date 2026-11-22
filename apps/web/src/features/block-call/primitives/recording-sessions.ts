import { formatLocale } from '@app/lib/i18n';
import { beginInteraction } from '@app/observability/flow';
import type { CallRecord } from '@service-call/client';
import type { CallRecordSession } from '@service-storage/generated/schemas/callRecordSession';
import type { CallRecordTranscriptSegment } from '@service-storage/generated/schemas/callRecordTranscriptSegment';
import { createWritableMemo } from '@solid-primitives/memo';
import { type Accessor, createMemo, on } from 'solid-js';

/** What selected a part: its tab, the previous part ending, or a transcript link. */
type PartTrigger = 'tab' | 'ended' | 'transcript_link';

/**
 * The part (0-based session index) a moment belongs to: the last part that
 * started at or before it. Moments before the second part, and unreadable
 * times, belong to the first.
 */
function partAt(time: string, sessions: CallRecordSession[]): number {
  const ms = new Date(time).getTime();
  let part = 0;
  for (let index = 1; index < sessions.length; index += 1) {
    if (ms >= new Date(sessions[index].startedAt).getTime()) part = index;
  }
  return part;
}

function partOfLine(
  line: CallRecordTranscriptSegment,
  sessions: CallRecordSession[]
): number {
  return partAt(line.startedAt, sessions);
}

/** A part's time window for its tab's tooltip, such as "10:00 – 10:20 AM". */
export function partTimeRange(session: CallRecordSession): string {
  const start = new Date(session.startedAt);
  const end = new Date(session.endedAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()))
    return '';
  return new Intl.DateTimeFormat(formatLocale(), {
    hour: 'numeric',
    minute: '2-digit',
  }).formatRange(start, end);
}

/**
 * The parts of a saved call: one per RTC session, more than one only when a
 * scheduled meeting emptied and was rejoined before its end. The selected part
 * narrows the record that playback and the transcript read, so the
 * single-recording timeline works per part unchanged; everything else keeps
 * reading the whole call.
 */
export function createRecordingSessions(record: Accessor<CallRecord>) {
  // A live call has no archived sessions; its earlier parts reappear once it
  // ends. A server deployed before sessions existed omits the field.
  const sessions = (): CallRecordSession[] =>
    record().isActive ? [] : (record().sessions ?? []);
  const hasParts = () => sessions().length > 1;

  // Another call starts at its first part; a refetch of the same call (a new
  // record object) keeps the selection.
  const callId = createMemo(() => record().callId);
  const [selected, setSelected] = createWritableMemo<number>(
    on(callId, () => 0)
  );
  const index = () => Math.min(selected(), Math.max(0, sessions().length - 1));

  // Narrowed once per record or selection, so downstream memos keep their
  // identity while playback time changes.
  const playbackRecord = createMemo((): CallRecord => {
    const current = record();
    if (!hasParts()) return current;
    const all = sessions();
    const part = index();
    const session = all[part];
    return {
      ...current,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      recordingStartedAt: session.recordingStartedAt,
      recordingUrl: session.recordingUrl,
      recordingPreviewUrl: session.recordingPreviewUrl,
      transcript: current.transcript.filter(
        (line) => partOfLine(line, all) === part
      ),
    };
  });

  const select = (part: number, trigger: PartTrigger) => {
    const count = sessions().length;
    if (part < 0 || part >= count || part === index()) return false;
    const interaction = beginInteraction('call.detail.part', {
      attributes: {
        'call.id': record().callId,
        'call.part': part,
        'call.parts': count,
        'call.part.trigger': trigger,
      },
    });
    try {
      setSelected(part);
    } finally {
      interaction.end();
    }
    return true;
  };

  return {
    sessions,
    hasParts,
    index,
    playbackRecord,
    /** Whether a moment (a chat message's time) falls in the selected part. */
    inSelectedPart: (time: string) =>
      !hasParts() || partAt(time, sessions()) === index(),
    /** Select a part from its tab. */
    select: (part: number) => select(part, 'tab'),
    /** Select the next part after the current one ends; false on the last. */
    advance: () => select(index() + 1, 'ended'),
    /**
     * Select the part holding a transcript line; true when that changed the
     * part, so the caller seeks once the part's recording has replaced the
     * current one.
     */
    selectPartOfLine: (transcriptId: string) => {
      if (!hasParts()) return false;
      const line = record().transcript.find(
        (segment) => segment.transcriptId === transcriptId
      );
      if (!line) return false;
      return select(partOfLine(line, sessions()), 'transcript_link');
    },
  };
}

export type RecordingSessions = ReturnType<typeof createRecordingSessions>;

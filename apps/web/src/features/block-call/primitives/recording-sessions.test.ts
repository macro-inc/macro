import type { CallRecord } from '@service-call/client';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createRecordingSessions } from './recording-sessions';

function line(transcriptId: string, sequenceNum: number, startedAt: string) {
  return {
    transcriptId,
    sequenceNum,
    startedAt,
    content: 'text',
    speakerId: 'macro|speaker@example.com',
  };
}

function twoPartRecord(callId = 'call-1'): CallRecord {
  return {
    callId,
    discussion: { kind: 'call_chat', call_id: callId },
    createdBy: 'macro|owner@example.com',
    guests: [],
    isActive: false,
    participants: [],
    shareWithTeam: false,
    startedAt: '2026-11-22T10:00:00Z',
    endedAt: '2026-11-22T10:50:00Z',
    recordingUrl: 'https://recordings.example/part-1.mp4',
    recordingStartedAt: '2026-11-22T10:00:05Z',
    sessions: [
      {
        startedAt: '2026-11-22T10:00:00Z',
        endedAt: '2026-11-22T10:20:00Z',
        recordingStartedAt: '2026-11-22T10:00:05Z',
        recordingUrl: 'https://recordings.example/part-1.mp4',
        recordingPreviewUrl: 'https://recordings.example/part-1.jpg',
      },
      {
        startedAt: '2026-11-22T10:30:00Z',
        endedAt: '2026-11-22T10:50:00Z',
        recordingStartedAt: '2026-11-22T10:30:04Z',
        recordingUrl: 'https://recordings.example/part-2.mp4',
        recordingPreviewUrl: 'https://recordings.example/part-2.jpg',
      },
    ],
    transcript: [
      // Spoken just before the first room's recorded start: still part one.
      line('t-early', 1, '2026-11-22T09:59:58Z'),
      line('t-1', 2, '2026-11-22T10:05:00Z'),
      // In the gap between the rooms: the first part, since the second has not begun.
      line('t-gap', 3, '2026-11-22T10:25:00Z'),
      line('t-2', 4, '2026-11-22T10:30:00Z'),
      line('t-3', 5, '2026-11-22T10:45:00Z'),
    ],
  };
}

function withSessions(record: CallRecord) {
  return createRoot((dispose) => {
    const [current, setCurrent] = createSignal(record);
    return { parts: createRecordingSessions(current), setCurrent, dispose };
  });
}

describe('recording sessions', () => {
  it('splits the transcript into parts by session start', () => {
    const { parts, dispose } = withSessions(twoPartRecord());

    expect(parts.hasParts()).toBe(true);
    expect(
      parts.playbackRecord().transcript.map((item) => item.transcriptId)
    ).toEqual(['t-early', 't-1', 't-gap']);

    parts.select(1);

    expect(
      parts.playbackRecord().transcript.map((item) => item.transcriptId)
    ).toEqual(['t-2', 't-3']);
    dispose();
  });

  it("plays the selected part's recording from its own origin", () => {
    const { parts, dispose } = withSessions(twoPartRecord());

    parts.select(1);

    expect(parts.playbackRecord().recordingUrl).toBe(
      'https://recordings.example/part-2.mp4'
    );
    expect(parts.playbackRecord().recordingPreviewUrl).toBe(
      'https://recordings.example/part-2.jpg'
    );
    expect(parts.playbackRecord().recordingStartedAt).toBe(
      '2026-11-22T10:30:04Z'
    );
    expect(parts.playbackRecord().startedAt).toBe('2026-11-22T10:30:00Z');
    dispose();
  });

  it('advances to the next part when one ends, and stops after the last', () => {
    const { parts, dispose } = withSessions(twoPartRecord());

    expect(parts.advance()).toBe(true);
    expect(parts.index()).toBe(1);
    expect(parts.advance()).toBe(false);
    expect(parts.index()).toBe(1);
    dispose();
  });

  it('selects the part holding a linked transcript line', () => {
    const { parts, dispose } = withSessions(twoPartRecord());

    expect(parts.selectPartOfLine('t-3')).toBe(true);
    expect(parts.index()).toBe(1);
    // Already in its part: nothing to switch, so the caller seeks right away.
    expect(parts.selectPartOfLine('t-2')).toBe(false);
    expect(parts.selectPartOfLine('t-gap')).toBe(true);
    expect(parts.index()).toBe(0);
    expect(parts.selectPartOfLine('missing')).toBe(false);
    expect(parts.index()).toBe(0);
    dispose();
  });

  it("keeps chat messages to the selected part's window", () => {
    const { parts, dispose } = withSessions(twoPartRecord());

    expect(parts.inSelectedPart('2026-11-22T10:25:00Z')).toBe(true);
    expect(parts.inSelectedPart('2026-11-22T10:31:00Z')).toBe(false);
    parts.select(1);
    expect(parts.inSelectedPart('2026-11-22T10:31:00Z')).toBe(true);
    dispose();
  });

  it('leaves a one-session record whole', () => {
    const record = twoPartRecord();
    const { parts, dispose } = withSessions({
      ...record,
      sessions: record.sessions.slice(0, 1),
    });

    expect(parts.hasParts()).toBe(false);
    expect(parts.playbackRecord().transcript).toHaveLength(5);
    expect(parts.selectPartOfLine('t-3')).toBe(false);
    dispose();
  });

  it('shows no parts while the call is live again', () => {
    const { parts, dispose } = withSessions({
      ...twoPartRecord(),
      isActive: true,
    });

    expect(parts.hasParts()).toBe(false);
    expect(parts.playbackRecord().transcript).toHaveLength(5);
    dispose();
  });

  it('starts another call at its first part', () => {
    const { parts, setCurrent, dispose } = withSessions(twoPartRecord());
    parts.select(1);

    // A refetch of the same call keeps the selection.
    setCurrent(twoPartRecord());
    expect(parts.index()).toBe(1);

    setCurrent(twoPartRecord('call-2'));
    expect(parts.index()).toBe(0);
    dispose();
  });
});

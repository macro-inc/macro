import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type CallPreviewParticipant,
  type CallPreviewPin,
  selectCallPreview,
} from '../core/call-mini-player';
import {
  CALL_SPEAKER_HOLD_MS,
  createHeldCallPreview,
} from '../primitives/call-mini-player-selection';

const WATCHED = {
  id: 'watched',
  speaking: false,
  hasVideo: true,
  sharing: false,
};
const SPEAKER = {
  id: 'speaker',
  speaking: true,
  hasVideo: true,
  sharing: false,
};
const PRESENTER = {
  id: 'presenter',
  speaking: false,
  hasVideo: true,
  sharing: true,
};

afterEach(() => vi.useRealTimers());

describe('call preview pin selection', () => {
  it('keeps a pinned person ahead of another speaker and screen share', () => {
    expect(
      selectCallPreview([SPEAKER, PRESENTER, WATCHED], {
        id: WATCHED.id,
        kind: 'participant',
      })
    ).toBe(WATCHED);
  });

  it('falls back when the pinned person leaves', () => {
    expect(
      selectCallPreview([SPEAKER, PRESENTER], {
        id: WATCHED.id,
        kind: 'participant',
      })
    ).toBe(PRESENTER);
  });

  it('selects a pinned screen ahead of another screen and speaker', () => {
    const watchedShare = { ...WATCHED, sharing: true };
    expect(
      selectCallPreview([SPEAKER, PRESENTER, watchedShare], {
        id: WATCHED.id,
        kind: 'share',
      })
    ).toBe(watchedShare);
  });

  it('falls back when a pinned screen ends even if its owner stays', () => {
    expect(
      selectCallPreview([WATCHED, SPEAKER], {
        id: WATCHED.id,
        kind: 'share',
      })
    ).toBe(SPEAKER);
  });

  it('retains share, speaker, video, and first-person priority without a pin', () => {
    const audioOnly = { ...WATCHED, hasVideo: false };
    expect(selectCallPreview([WATCHED, SPEAKER, PRESENTER])).toBe(PRESENTER);
    expect(selectCallPreview([WATCHED, SPEAKER])).toBe(SPEAKER);
    expect(selectCallPreview([audioOnly, WATCHED])).toBe(WATCHED);
    expect(selectCallPreview([audioOnly])).toBe(audioOnly);
    expect(selectCallPreview([])).toBeUndefined();
  });
});

describe('held call preview', () => {
  it('applies pins and unpins immediately, cancels pending switches, then holds speakers again', () => {
    vi.useFakeTimers();
    const dispose = createRoot((dispose) => {
      const [participants, setParticipants] = createSignal<
        CallPreviewParticipant[]
      >([WATCHED]);
      const [pin, setPin] = createSignal<CallPreviewPin>();
      const selected = createHeldCallPreview(participants, () => false, pin);
      return { dispose, setParticipants, setPin, selected };
    });
    try {
      dispose.setParticipants([WATCHED, SPEAKER]);
      expect(dispose.selected()?.id).toBe(WATCHED.id);
      dispose.setPin({ id: WATCHED.id, kind: 'participant' });
      vi.advanceTimersByTime(CALL_SPEAKER_HOLD_MS);
      expect(dispose.selected()?.id).toBe(WATCHED.id);

      dispose.setPin(undefined);
      expect(dispose.selected()?.id).toBe(SPEAKER.id);
      dispose.setParticipants([
        { ...WATCHED, speaking: true },
        { ...SPEAKER, speaking: false },
      ]);
      expect(dispose.selected()?.id).toBe(SPEAKER.id);
      vi.advanceTimersByTime(CALL_SPEAKER_HOLD_MS);
      expect(dispose.selected()?.id).toBe(WATCHED.id);
    } finally {
      dispose.dispose();
    }
  });

  it('falls back immediately when a pinned participant leaves', () => {
    vi.useFakeTimers();
    const test = createRoot((dispose) => {
      const [participants, setParticipants] = createSignal([WATCHED, SPEAKER]);
      const selected = createHeldCallPreview(
        participants,
        () => false,
        () => ({
          id: WATCHED.id,
          kind: 'participant',
        })
      );
      return { dispose, setParticipants, selected };
    });
    try {
      expect(test.selected()?.id).toBe(WATCHED.id);
      test.setParticipants([SPEAKER]);
      expect(test.selected()?.id).toBe(SPEAKER.id);
    } finally {
      test.dispose();
    }
  });
});

import { renderHook } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import type { AudioRecorderCallbacks, RecorderHandle } from '../core/recording';
import { FEEDBACK_MS } from '../core/types';
import { createRecordedDictation } from './create-recorded-dictation';

const audio = new Blob(['audio'], { type: 'audio/webm' });

/** A recorder whose events the test fires explicitly. */
class FakeRecorder implements RecorderHandle {
  static latest: FakeRecorder;
  /** Overrides how the next constructed recorder acquires the microphone. */
  static nextStart: (() => Promise<void>) | undefined;
  start = vi.fn(FakeRecorder.nextStart ?? (async () => {}));
  /** The primitive receives a completed recording through its recorder contract. */
  stop = vi.fn(() => this.callbacks.onRecording?.(audio));
  cancel = vi.fn();
  constructor(readonly callbacks: AudioRecorderCallbacks) {
    FakeRecorder.latest = this;
  }
}

function setup() {
  let now = 1_000;
  const transcribe = vi.fn(
    async (_blob: Blob, _signal: AbortSignal) => 'recognized words'
  );
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const trace = {
    event: vi.fn(),
    run: <T>(operation: () => T) => operation(),
    setAttr: vi.fn(),
    error: vi.fn(),
    end: vi.fn(),
  };
  const hook = renderHook(() =>
    createRecordedDictation({
      supported: true,
      startTrace: () => trace,
      createRecorder: (callbacks) => new FakeRecorder(callbacks),
      transcribe,
      onConfirm,
      onCancel,
      now: () => now,
    })
  );
  return {
    ...hook,
    transcribe,
    onConfirm,
    onCancel,
    trace,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('Whisper dictation', () => {
  it('uploads only on confirm and appends the result once', async () => {
    const test = setup();
    await test.result.start();
    expect(test.result.phase()).toBe('listening');
    expect(test.transcribe).not.toHaveBeenCalled();
    const first = test.result.confirm();
    const second = test.result.confirm();
    await Promise.all([first, second]);
    expect(test.onConfirm).toHaveBeenCalledExactlyOnceWith('recognized words');
    expect(test.transcribe).toHaveBeenCalledExactlyOnceWith(
      audio,
      expect.any(AbortSignal),
      test.trace
    );
    expect(test.result.phase()).toBe('idle');
    expect(test.result.message()).toBe('');
    expect(test.trace.setAttr).toHaveBeenCalledWith(
      'dictation.outcome',
      'success'
    );
    expect(test.trace.end).toHaveBeenCalledOnce();
  });

  it('keeps a bounded, listening-only volume timeline', async () => {
    const test = setup();
    await test.result.start();
    const { onLevel } = FakeRecorder.latest.callbacks;
    onLevel?.(0.2);
    onLevel?.(0.9);
    expect(test.result.volumeHistory()).toEqual([0.2, 0.9]);
    const confirmed = test.result.confirm();
    onLevel?.(0.5);
    await confirmed;
    expect(test.result.volumeHistory()).toEqual([]);
  });

  it('discards cancellation without uploading', async () => {
    const test = setup();
    await test.result.start();
    test.result.cancel();
    expect(FakeRecorder.latest.cancel).toHaveBeenCalledOnce();
    expect(test.transcribe).not.toHaveBeenCalled();
    expect(test.onConfirm).not.toHaveBeenCalled();
    expect(test.onCancel).toHaveBeenCalledOnce();
    expect(test.result.phase()).toBe('idle');
    expect(test.trace.setAttr).toHaveBeenCalledWith(
      'dictation.outcome',
      'cancelled'
    );
    expect(test.trace.end).toHaveBeenCalledOnce();
  });

  it('aborts an upload and ignores a late transcription', async () => {
    const test = setup();
    let resolve!: (text: string) => void;
    test.transcribe.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    await test.result.start();
    const confirmed = test.result.confirm();
    expect(test.transcribe).toHaveBeenCalledOnce();
    const signal = test.transcribe.mock.calls[0][1];
    test.result.cancel();
    expect(signal.aborted).toBe(true);
    resolve('must not insert');
    await confirmed;
    expect(test.onConfirm).not.toHaveBeenCalled();
    expect(test.result.phase()).toBe('idle');
    expect(test.trace.setAttr).toHaveBeenCalledWith(
      'dictation.outcome',
      'cancelled'
    );
    expect(test.trace.end).toHaveBeenCalledOnce();
  });

  it('keeps audio for explicit retry after a provider failure', async () => {
    const test = setup();
    test.transcribe.mockRejectedValueOnce(new Error('Try again'));
    await test.result.start();
    await test.result.confirm();
    expect(test.result.phase()).toBe('review');
    expect(test.result.message()).toBe('Try again');
    expect(test.result.messageTone()).toBe('error');
    expect(test.onConfirm).not.toHaveBeenCalled();
    expect(test.trace.event).toHaveBeenCalledWith('dictation.upload_failed', {
      attempt: 1,
    });
    expect(test.trace.end).not.toHaveBeenCalled();
    await test.result.confirm();
    expect(test.onConfirm).toHaveBeenCalledExactlyOnceWith('recognized words');
    expect(FakeRecorder.latest.stop).toHaveBeenCalledOnce();
    expect(test.trace.event).toHaveBeenCalledWith('dictation.upload_started', {
      attempt: 2,
      audioBytes: audio.size,
    });
    expect(test.trace.setAttr).toHaveBeenCalledWith(
      'dictation.outcome',
      'success'
    );
    expect(test.trace.end).toHaveBeenCalledOnce();
  });

  it('waits for confirmation after the recorder stops at its limit', async () => {
    const test = setup();
    await test.result.start();
    const recorder = FakeRecorder.latest;
    recorder.callbacks.onLimit?.();
    recorder.callbacks.onRecording?.(audio);
    expect(test.result.phase()).toBe('review');
    expect(test.result.limitReached()).toBe(true);
    expect(test.result.message()).toMatch(/limit/i);
    expect(test.result.messageTone()).toBe('info');
    expect(test.transcribe).not.toHaveBeenCalled();
    await test.result.confirm();
    expect(test.onConfirm).toHaveBeenCalledOnce();
  });

  it('returns to idle with a message when capture fails mid-recording', async () => {
    const test = setup();
    await test.result.start();
    FakeRecorder.latest.callbacks.onError(new Error('Microphone unplugged'));
    expect(test.result.phase()).toBe('idle');
    expect(test.result.message()).toBe('Microphone unplugged');
    expect(test.transcribe).not.toHaveBeenCalled();
  });

  it('releases its composer when another session takes the microphone', async () => {
    const test = setup();
    await test.result.start();
    const previous = FakeRecorder.latest;
    previous.callbacks.onInterrupted();
    expect(test.result.phase()).toBe('idle');
    expect(test.result.active()).toBe(false);
    expect(test.onCancel).not.toHaveBeenCalled();
    previous.callbacks.onRecording(audio);
    expect(test.transcribe).not.toHaveBeenCalled();
    expect(test.onConfirm).not.toHaveBeenCalled();
  });

  it('settles a pending confirmation when its recording is interrupted', async () => {
    const test = setup();
    await test.result.start();
    FakeRecorder.latest.stop.mockImplementation(() => {});
    const confirmed = test.result.confirm();
    FakeRecorder.latest.callbacks.onInterrupted();
    await confirmed;
    expect(test.result.phase()).toBe('idle');
    expect(test.transcribe).not.toHaveBeenCalled();
  });

  it('reports permission failures without leaving the composer stuck', async () => {
    const test = setup();
    FakeRecorder.nextStart = async () => {
      throw new Error('denied');
    };
    await test.result.start();
    FakeRecorder.nextStart = undefined;
    expect(test.result.phase()).toBe('idle');
    expect(test.result.message()).toMatch(/microphone/i);
  });

  it('cancels a recorder granted after disposal', async () => {
    const test = setup();
    let grant!: () => void;
    FakeRecorder.nextStart = () =>
      new Promise<void>((resolve) => {
        grant = resolve;
      });
    const starting = test.result.start();
    FakeRecorder.nextStart = undefined;
    test.cleanup();
    grant();
    await starting;
    expect(FakeRecorder.latest.cancel).toHaveBeenCalled();
    expect(test.transcribe).not.toHaveBeenCalled();
  });

  it('times the recording while listening and keeps its length for review', async () => {
    const test = setup();
    await test.result.start();
    test.advance(3_400);
    FakeRecorder.latest.callbacks.onLevel?.(0.4);
    expect(test.result.elapsedMs()).toBe(3_400);
    test.advance(600);
    FakeRecorder.latest.callbacks.onRecording?.(audio);
    expect(test.result.phase()).toBe('review');
    expect(test.result.elapsedMs()).toBe(4_000);
  });

  it('clears a note about the last attempt after a while, or on request', async () => {
    vi.useFakeTimers();
    try {
      const test = setup();
      test.transcribe.mockResolvedValueOnce('  ');
      await test.result.start();
      await test.result.confirm();
      expect(test.result.phase()).toBe('idle');
      expect(test.result.message()).toMatch(/no speech/i);
      vi.advanceTimersByTime(FEEDBACK_MS);
      expect(test.result.message()).toBe('');

      test.transcribe.mockResolvedValueOnce('');
      await test.result.start();
      await test.result.confirm();
      expect(test.result.message()).not.toBe('');
      test.result.clearMessage();
      expect(test.result.message()).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a failed transcription in review instead of expiring it', async () => {
    vi.useFakeTimers();
    try {
      const test = setup();
      test.transcribe.mockRejectedValueOnce(new Error('Offline'));
      await test.result.start();
      await test.result.confirm();
      vi.advanceTimersByTime(FEEDBACK_MS * 2);
      expect(test.result.phase()).toBe('review');
      expect(test.result.message()).toBe('Offline');
    } finally {
      vi.useRealTimers();
    }
  });
});

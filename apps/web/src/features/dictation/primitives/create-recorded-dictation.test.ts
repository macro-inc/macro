import { renderHook } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import type { AudioRecorderCallbacks, RecorderHandle } from '../core/recording';
import { createRecordedDictation } from './create-recorded-dictation';

const audio = new Blob(['audio'], { type: 'audio/webm' });

/** A recorder whose events the test fires explicitly. */
class FakeRecorder implements RecorderHandle {
  static latest: FakeRecorder;
  /** Overrides how the next constructed recorder acquires the microphone. */
  static nextStart: (() => Promise<void>) | undefined;
  start = vi.fn(FakeRecorder.nextStart ?? (async () => {}));
  /** Deliver the recording synchronously, as a finished MediaRecorder would. */
  stop = vi.fn(() => this.callbacks.onRecording?.(audio));
  cancel = vi.fn();
  constructor(readonly callbacks: AudioRecorderCallbacks) {
    FakeRecorder.latest = this;
  }
}

function setup() {
  const transcribe = vi.fn(
    async (_blob: Blob, _signal: AbortSignal) => 'recognized words'
  );
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const hook = renderHook(() =>
    createRecordedDictation({
      supported: true,
      createRecorder: (callbacks) => new FakeRecorder(callbacks),
      transcribe,
      onConfirm,
      onCancel,
    })
  );
  return { ...hook, transcribe, onConfirm, onCancel };
}

describe('Whisper fallback', () => {
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
      expect.any(AbortSignal)
    );
    expect(test.result.phase()).toBe('idle');
    expect(test.result.message()).toBe('');
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
  });

  it('keeps audio for explicit retry after a provider failure', async () => {
    const test = setup();
    test.transcribe.mockRejectedValueOnce(new Error('Try again'));
    await test.result.start();
    await test.result.confirm();
    expect(test.result.phase()).toBe('review');
    expect(test.result.message()).toBe('Try again');
    expect(test.onConfirm).not.toHaveBeenCalled();
    await test.result.confirm();
    expect(test.onConfirm).toHaveBeenCalledExactlyOnceWith('recognized words');
    expect(FakeRecorder.latest.stop).toHaveBeenCalledOnce();
  });

  it('waits for confirmation after the recorder stops at its limit', async () => {
    const test = setup();
    await test.result.start();
    const recorder = FakeRecorder.latest;
    recorder.callbacks.onLimit?.();
    recorder.callbacks.onRecording?.(audio);
    expect(test.result.phase()).toBe('review');
    expect(test.result.message()).toMatch(/limit/i);
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
});

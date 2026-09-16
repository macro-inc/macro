import { renderHook, waitFor } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import type { StartRecording } from '../core/recording';
import { createRecordedDictation } from './create-recorded-dictation';

function setup() {
  const blob = new Blob(['audio'], { type: 'audio/webm' });
  const finish = vi.fn(async () => blob);
  const cancel = vi.fn();
  let recorderOptions!: Parameters<StartRecording>[0];
  const startRecording = vi.fn<StartRecording>(async (options) => {
    recorderOptions = options;
    return { finish, cancel };
  });
  const transcribe = vi.fn(
    async (_blob: Blob, _signal: AbortSignal) => 'recognized words'
  );
  const onConfirm = vi.fn();
  const hook = renderHook(() =>
    createRecordedDictation({
      supported: true,
      startRecording,
      transcribe,
      onConfirm,
    })
  );
  return {
    ...hook,
    blob,
    finish,
    cancel,
    startRecording,
    transcribe,
    onConfirm,
    options: () => recorderOptions,
  };
}

describe('Whisper fallback', () => {
  it('uploads only on confirm and appends the result once', async () => {
    const test = setup();
    await test.result.start();
    expect(test.transcribe).not.toHaveBeenCalled();
    test.result.confirm();
    test.result.confirm();
    await waitFor(() =>
      expect(test.onConfirm).toHaveBeenCalledExactlyOnceWith('recognized words')
    );
    expect(test.transcribe).toHaveBeenCalledExactlyOnceWith(
      test.blob,
      expect.any(AbortSignal)
    );
    expect(test.result.phase()).toBe('idle');
  });
  it('discards cancellation without uploading', async () => {
    const test = setup();
    await test.result.start();
    test.result.cancel();
    expect(test.options().signal.aborted).toBe(true);
    expect(test.cancel).toHaveBeenCalledOnce();
    expect(test.transcribe).not.toHaveBeenCalled();
    expect(test.onConfirm).not.toHaveBeenCalled();
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
    test.result.confirm();
    await waitFor(() => expect(test.transcribe).toHaveBeenCalledOnce());
    const signal = test.transcribe.mock.calls[0][1];
    test.result.cancel();
    resolve('must not insert');
    await Promise.resolve();
    expect(signal.aborted).toBe(true);
    expect(test.onConfirm).not.toHaveBeenCalled();
  });
  it('keeps audio for explicit retry after a provider failure', async () => {
    const test = setup();
    test.transcribe.mockRejectedValueOnce(new Error('Try again'));
    await test.result.start();
    test.result.confirm();
    await waitFor(() => expect(test.result.phase()).toBe('review'));
    expect(test.onConfirm).not.toHaveBeenCalled();
    test.result.confirm();
    await waitFor(() => expect(test.onConfirm).toHaveBeenCalledOnce());
    expect(test.finish).toHaveBeenCalledOnce();
  });
  it('stops at the limit without uploading until the user confirms', async () => {
    const test = setup();
    await test.result.start();
    test.options().onLimit();
    await waitFor(() => expect(test.result.phase()).toBe('review'));
    expect(test.transcribe).not.toHaveBeenCalled();
    test.result.confirm();
    await waitFor(() => expect(test.onConfirm).toHaveBeenCalledOnce());
  });
  it('cancels a recorder granted after disposal', async () => {
    const test = setup();
    let resolve!: (value: {
      finish: typeof test.finish;
      cancel: typeof test.cancel;
    }) => void;
    test.startRecording.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const start = test.result.start();
    test.cleanup();
    resolve({ finish: test.finish, cancel: test.cancel });
    await start;
    expect(test.cancel).toHaveBeenCalledOnce();
    expect(test.transcribe).not.toHaveBeenCalled();
  });
});

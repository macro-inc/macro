import {
  DictationCapacityError,
  transcribeDictation,
} from '@service-storage/dictation';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backoffMs, transcribeAudio } from './transcribe';

vi.mock('@service-storage/dictation', async (original) => ({
  ...(await original<typeof import('@service-storage/dictation')>()),
  transcribeDictation: vi.fn(),
}));

const upload = vi.mocked(transcribeDictation);
const audio = new Blob(['PRIVATE_AUDIO'], { type: 'audio/webm' });

beforeEach(() => {
  upload.mockReset();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('backoff', () => {
  it('waits the longer of Retry-After and exponential backoff, plus jitter', () => {
    expect(backoffMs(0, 0)).toBe(1_125);
    expect(backoffMs(1, 0)).toBe(2_125);
    expect(backoffMs(0, 3_000)).toBe(3_125);
  });
});

describe('dictation capacity retries', () => {
  it('honors Retry-After and traces every attempt', async () => {
    const run = vi.fn();
    const trace = {
      run: <T>(operation: () => T): T => {
        run();
        return operation();
      },
      event: vi.fn(),
    };
    upload.mockResolvedValueOnce(err([new DictationCapacityError(3_000)]));
    upload.mockResolvedValueOnce(ok({ text: 'PRIVATE_TRANSCRIPT' }));
    const controller = new AbortController();
    const result = transcribeAudio(audio, 'en-US', controller.signal, trace);
    await vi.advanceTimersByTimeAsync(3_124);
    expect(upload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('PRIVATE_TRANSCRIPT');
    expect(upload).toHaveBeenNthCalledWith(
      2,
      audio,
      'en-US',
      controller.signal
    );
    expect(run).toHaveBeenCalledTimes(2);
    expect(trace.event).toHaveBeenCalledExactlyOnceWith(
      'dictation.upload_retry',
      { attempt: 2 }
    );
  });

  it('stops after two retries with exponential backoff', async () => {
    upload.mockResolvedValue(err([new DictationCapacityError(1_000)]));
    const result = transcribeAudio(audio, 'en', new AbortController().signal);
    const rejected = expect(result).rejects.toThrow('Dictation is busy');
    await vi.advanceTimersByTimeAsync(1_125);
    expect(upload).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_125);
    await rejected;
    expect(upload).toHaveBeenCalledTimes(3);
  });

  it.each([
    'DICTATION_RATE_LIMITED',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'HTTP_ERROR',
    'NETWORK_ERROR',
  ] as const)('does not automatically replay %s failures', async (code) => {
    upload.mockResolvedValue(err([{ code, message: 'Terminal failure' }]));
    await expect(
      transcribeAudio(audio, 'en', new AbortController().signal)
    ).rejects.toThrow('Terminal failure');
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('does not wait for an excessive server delay', async () => {
    upload.mockResolvedValue(err([new DictationCapacityError(60_000)]));
    await expect(
      transcribeAudio(audio, 'en', new AbortController().signal)
    ).rejects.toThrow('Dictation is busy');
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('cancels during backoff immediately and never sends the scheduled retry', async () => {
    upload.mockResolvedValue(err([new DictationCapacityError(1_000)]));
    const controller = new AbortController();
    const result = transcribeAudio(audio, 'en', controller.signal);
    const rejected = expect(result).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('cancels an in-flight upload and ignores its late result', async () => {
    let finish!: (
      result: Awaited<ReturnType<typeof transcribeDictation>>
    ) => void;
    let started!: () => void;
    const requested = new Promise<void>((resolve) => {
      started = resolve;
    });
    upload.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
          started();
        })
    );
    const controller = new AbortController();
    const result = transcribeAudio(audio, 'en', controller.signal);
    const rejected = expect(result).rejects.toMatchObject({
      name: 'AbortError',
    });
    await requested;
    controller.abort();
    await rejected;
    // The late transcript resolves into a promise nothing is listening to.
    finish(ok({ text: 'PRIVATE_LATE_TRANSCRIPT' }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('does not upload an already cancelled recording', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      transcribeAudio(audio, 'en', controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(upload).not.toHaveBeenCalled();
  });
});

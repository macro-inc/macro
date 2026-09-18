import {
  DictationCapacityError,
  transcribeDictation,
} from '@service-storage/dictation';
import { timeoutManager } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../client';
import { transcribeAudio } from './transcribe';

vi.mock('../client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});
vi.mock('@service-storage/dictation', async (original) => ({
  ...(await original<typeof import('@service-storage/dictation')>()),
  transcribeDictation: vi.fn(),
}));

const upload = vi.mocked(transcribeDictation);
const audio = new Blob(['PRIVATE_AUDIO'], { type: 'audio/webm' });

/** Execute TanStack's scheduled callbacks explicitly; no clock advancement. */
function controlRetries() {
  type Retry = { delay: number; fire: () => void };
  const queued: Retry[] = [];
  let listener: ((retry: Retry) => void) | undefined;
  let id = 0;
  vi.spyOn(timeoutManager, 'setTimeout').mockImplementation(
    (callback, delay) => {
      if (delay > 0) {
        const retry = { delay, fire: () => callback() };
        if (listener) {
          listener(retry);
          listener = undefined;
        } else queued.push(retry);
      }
      return ++id;
    }
  );
  vi.spyOn(timeoutManager, 'clearTimeout').mockImplementation(() => {});
  return {
    async next(): Promise<Retry> {
      const retry = queued.shift();
      if (retry) return retry;
      return new Promise((resolve) => {
        listener = resolve;
      });
    },
  };
}

function settled() {
  return new Promise<void>((resolve) => {
    const unsubscribe = queryClient.getMutationCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        ['success', 'error'].includes(event.mutation.state.status)
      ) {
        unsubscribe();
        resolve();
      }
    });
  });
}

beforeEach(() => {
  upload.mockReset();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});
afterEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
});

describe('dictation capacity retries', () => {
  it('honors Retry-After, preserves tracing, and keeps content out of mutation state', async () => {
    const retries = controlRetries();
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
    const retry = await retries.next();
    expect(retry.delay).toBe(3_125);
    expect(upload).toHaveBeenCalledTimes(1);
    const mutation = queryClient.getMutationCache().getAll()[0];
    expect(mutation.state.variables).toBeUndefined();
    expect(mutation.state.data).toBeUndefined();
    expect(JSON.stringify(mutation.state)).not.toContain('PRIVATE');
    retry.fire();
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
    expect(mutation.state.data).toBeUndefined();
    expect(mutation.state.variables).toBeUndefined();
  });

  it('stops after two retries with exponential backoff and jitter', async () => {
    const retries = controlRetries();
    upload.mockResolvedValue(err([new DictationCapacityError(1_000)]));
    const result = transcribeAudio(audio, 'en', new AbortController().signal);
    const rejected = expect(result).rejects.toThrow('Dictation is busy');
    const first = await retries.next();
    expect(first.delay).toBe(1_125);
    first.fire();
    const second = await retries.next();
    expect(second.delay).toBe(2_125);
    second.fire();
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
    const retries = controlRetries();
    upload.mockResolvedValue(err([new DictationCapacityError(1_000)]));
    const controller = new AbortController();
    const done = settled();
    const result = transcribeAudio(audio, 'en', controller.signal);
    const rejected = expect(result).rejects.toMatchObject({
      name: 'AbortError',
    });
    const retry = await retries.next();
    controller.abort();
    await rejected;
    retry.fire();
    await done;
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
    const done = settled();
    const result = transcribeAudio(audio, 'en', controller.signal);
    const rejected = expect(result).rejects.toMatchObject({
      name: 'AbortError',
    });
    await requested;
    controller.abort();
    await rejected;
    finish(ok({ text: 'PRIVATE_LATE_TRANSCRIPT' }));
    await done;
    expect(upload).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(
        queryClient
          .getMutationCache()
          .getAll()
          .map((mutation) => mutation.state)
      )
    ).not.toContain('PRIVATE');
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

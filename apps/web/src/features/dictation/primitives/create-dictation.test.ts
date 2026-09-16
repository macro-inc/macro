import { renderHook, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LocalSpeechRecognition,
  SpeechAvailability,
  StartVolumeMeter,
} from '../core/types';
import { MAX_VOLUME_SAMPLES } from '../core/volume';
import { createDictation } from './create-dictation';

class Recognition implements LocalSpeechRecognition {
  static available = vi.fn(
    async (): Promise<SpeechAvailability> => 'available'
  );
  static install = vi.fn(async () => true);
  static latest: Recognition;
  processLocally = false;
  lang = '';
  continuous = false;
  interimResults = false;
  onstart: LocalSpeechRecognition['onstart'] = null;
  onend: LocalSpeechRecognition['onend'] = null;
  onerror: LocalSpeechRecognition['onerror'] = null;
  onresult: LocalSpeechRecognition['onresult'] = null;
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    Recognition.latest = this;
  }
  result(...texts: string[]) {
    this.onresult?.({
      results: texts.map((transcript) => ({
        0: { transcript },
        isFinal: false,
      })),
    });
  }
}

async function setup(
  recognition = Recognition,
  startVolumeMeter?: StartVolumeMeter
) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const hook = renderHook(() =>
    createDictation({
      recognition,
      language: 'en-US',
      onConfirm,
      onCancel,
      startVolumeMeter,
    })
  );
  await waitFor(() => expect(hook.result.phase()).toBe('idle'));
  return { ...hook, onConfirm, onCancel };
}

beforeEach(() => {
  Recognition.available.mockReset().mockResolvedValue('available');
  Recognition.install.mockReset().mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

describe('local dictation', () => {
  it('keeps a bounded volume timeline and stops sampling immediately on confirm', async () => {
    let sample!: (level: number) => void;
    const stop = vi.fn();
    const { result } = await setup(Recognition, (onLevel) => {
      sample = onLevel;
      return { stop };
    });
    await result.start();
    sample(0.1);
    sample(0.8);
    sample(0);
    expect(result.volumeHistory()).toEqual([0.1, 0.8, 0]);
    for (let index = 0; index < MAX_VOLUME_SAMPLES; index++) sample(0.5);
    expect(result.volumeHistory()).toHaveLength(MAX_VOLUME_SAMPLES);
    result.confirm();
    expect(stop).toHaveBeenCalledOnce();
    sample(1);
    expect(result.volumeHistory().at(-1)).toBe(0.5);
    result.cancel();
    expect(result.volumeHistory()).toEqual([]);
  });

  it('releases volume analysis on error and unmount, and resets for each recording', async () => {
    let sample!: (level: number) => void;
    const stop = vi.fn();
    const { result, cleanup } = await setup(Recognition, (onLevel) => {
      sample = onLevel;
      return { stop };
    });
    await result.start();
    sample(0.8);
    Recognition.latest.onerror?.({ error: 'no-speech' });
    expect(stop).toHaveBeenCalledTimes(1);
    await result.start();
    expect(result.volumeHistory()).toEqual([]);
    cleanup();
    sample(1);
    expect(stop).toHaveBeenCalledTimes(2);
    expect(result.volumeHistory()).toEqual([]);
  });

  it('disables dictation without a local recognizer or supported language', async () => {
    const unsupported = renderHook(() =>
      createDictation({ language: 'en-US', onConfirm: vi.fn() })
    );
    expect(unsupported.result.phase()).toBe('unavailable');
    expect(unsupported.result.disabled()).toBe(true);
    Recognition.available.mockResolvedValue('unavailable');
    const unavailable = renderHook(() =>
      createDictation({
        recognition: Recognition,
        language: 'fr-FR',
        onConfirm: vi.fn(),
      })
    );
    await waitFor(() => expect(unavailable.result.phase()).toBe('unavailable'));
    expect(Recognition.available).toHaveBeenCalledWith({
      langs: ['fr-FR'],
      processLocally: true,
    });
  });

  it('enforces local processing and waits for corrected final words after confirmation', async () => {
    const { result, onConfirm } = await setup();
    await result.start();
    const speech = Recognition.latest;
    expect(speech.processLocally).toBe(true);
    expect(speech.lang).toBe('en-US');
    speech.result('A first guess');
    speech.result('The corrected sentence.', 'Another thought');
    result.confirm();
    expect(speech.stop).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    speech.result('The corrected sentence.', 'Another thought.');
    speech.onend?.();
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(
      'The corrected sentence. Another thought.'
    );
    expect(result.active()).toBe(false);
  });

  it('cancels without committing and detaches late callbacks', async () => {
    const { result, onConfirm, onCancel } = await setup();
    await result.start();
    const speech = Recognition.latest;
    speech.result('discard this');
    result.confirm();
    result.cancel();
    speech.result('late words');
    speech.onend?.();
    expect(speech.abort).toHaveBeenCalledOnce();
    expect(speech.onresult).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(result.transcript()).toBe('');
  });

  it('keeps naturally-ended speech for explicit review', async () => {
    const { result, onConfirm } = await setup();
    await result.start();
    Recognition.latest.result('Keep this');
    Recognition.latest.onend?.();
    expect(result.phase()).toBe('review');
    expect(onConfirm).not.toHaveBeenCalled();
    result.confirm();
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith('Keep this');
  });

  it('releases the microphone and finalization timeout on unmount', async () => {
    const { result, cleanup, onConfirm } = await setup();
    vi.useFakeTimers();
    await result.start();
    Recognition.latest.result('do not insert after navigation');
    result.confirm();
    cleanup();
    vi.runAllTimers();
    expect(Recognition.latest.abort).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('recovers from permission denial and preserves partial text on error', async () => {
    const { result, onConfirm } = await setup();
    await result.start();
    Recognition.latest.onerror?.({ error: 'not-allowed' });
    expect(result.phase()).toBe('idle');
    expect(result.message()).toContain('denied');
    await result.start();
    Recognition.latest.result('Retain my words');
    Recognition.latest.onerror?.({ error: 'audio-capture' });
    expect(result.phase()).toBe('review');
    result.confirm();
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith('Retain my words');
  });

  it('downloads only on click and requires another gesture to record', async () => {
    Recognition.available.mockResolvedValue('downloadable');
    const { result } = await setup();
    expect(Recognition.install).not.toHaveBeenCalled();
    expect(result.label()).toContain('Download');
    await result.start();
    expect(Recognition.install).toHaveBeenCalledExactlyOnceWith({
      langs: ['en-US'],
      processLocally: true,
    });
    expect(result.phase()).toBe('idle');
    expect(result.label()).toBe('Start dictation');
    await result.start();
    expect(result.phase()).toBe('listening');
  });

  it('ignores a language download that finishes after unmount', async () => {
    Recognition.available.mockResolvedValue('downloadable');
    let resolveInstall!: (value: boolean) => void;
    Recognition.install.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInstall = resolve;
        })
    );
    const { result, cleanup, onConfirm } = await setup();
    const starting = result.start();
    cleanup();
    resolveInstall(true);
    await starting;
    expect(result.phase()).toBe('installing');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('finishes even when a browser never emits end', async () => {
    const { result, onConfirm } = await setup();
    vi.useFakeTimers();
    await result.start();
    Recognition.latest.result('Last available words');
    result.confirm();
    vi.advanceTimersByTime(3000);
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith('Last available words');
    expect(Recognition.latest.abort).toHaveBeenCalledOnce();
  });
});

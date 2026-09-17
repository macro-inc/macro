import { renderHook, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioRecorderCallbacks, RecorderHandle } from '../core/recording';
import type { LocalSpeechRecognition, SpeechAvailability } from '../core/types';
import { MAX_VOLUME_SAMPLES } from '../core/volume';
import { createLocalDictation } from './create-local-dictation';

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

/** Meter-only recorder; the test fires its level events. */
class FakeMeter implements RecorderHandle {
  static latest: FakeMeter | undefined;
  /** Overrides how the next constructed meter acquires the microphone. */
  static nextStart: (() => Promise<void>) | undefined;
  start = vi.fn(FakeMeter.nextStart ?? (async () => {}));
  stop = vi.fn();
  cancel = vi.fn();
  constructor(readonly callbacks: AudioRecorderCallbacks) {
    FakeMeter.latest = this;
  }
}

async function setup(recognition = Recognition, withMeter = false) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const hook = renderHook(() =>
    createLocalDictation({
      recognition,
      language: 'en-US',
      onConfirm,
      onCancel,
      createRecorder: withMeter
        ? (callbacks) => new FakeMeter(callbacks)
        : undefined,
    })
  );
  await waitFor(() => expect(hook.result.phase()).toBe('idle'));
  return { ...hook, onConfirm, onCancel };
}

const meter = () => {
  if (!FakeMeter.latest) throw new Error('no meter was created');
  return FakeMeter.latest;
};

beforeEach(() => {
  Recognition.available.mockReset().mockResolvedValue('available');
  Recognition.install.mockReset().mockResolvedValue(true);
  FakeMeter.latest = undefined;
  FakeMeter.nextStart = undefined;
});

describe('local dictation', () => {
  it('keeps a bounded volume timeline and stops metering on confirm', async () => {
    const { result } = await setup(Recognition, true);
    await result.start();
    const { onLevel } = meter().callbacks;
    onLevel?.(0.1);
    onLevel?.(0.8);
    onLevel?.(0);
    expect(result.volumeHistory()).toEqual([0.1, 0.8, 0]);
    for (let index = 0; index < MAX_VOLUME_SAMPLES; index++) onLevel?.(0.5);
    expect(result.volumeHistory()).toHaveLength(MAX_VOLUME_SAMPLES);
    const confirmed = result.confirm();
    expect(meter().cancel).toHaveBeenCalledOnce();
    onLevel?.(1);
    expect(result.volumeHistory().at(-1)).toBe(0.5);
    result.cancel();
    await confirmed;
    expect(result.volumeHistory()).toEqual([]);
  });

  it('releases the meter on error and unmount, and resets per recording', async () => {
    const { result, cleanup } = await setup(Recognition, true);
    await result.start();
    const first = meter();
    first.callbacks.onLevel?.(0.8);
    Recognition.latest.onerror?.({ error: 'no-speech' });
    expect(first.cancel).toHaveBeenCalledOnce();
    await result.start();
    expect(result.volumeHistory()).toEqual([]);
    const second = meter();
    expect(second).not.toBe(first);
    cleanup();
    second.callbacks.onLevel?.(1);
    expect(second.cancel).toHaveBeenCalledOnce();
    expect(result.volumeHistory()).toEqual([]);
  });

  it('dictates without a timeline when the meter cannot start', async () => {
    const { result } = await setup(Recognition, true);
    FakeMeter.nextStart = async () => {
      throw new Error('busy');
    };
    await result.start();
    FakeMeter.nextStart = undefined;
    await waitFor(() => expect(result.message()).toMatch(/volume/i));
    expect(result.phase()).toBe('listening');
  });

  it('disables dictation without a local recognizer or supported language', async () => {
    const unsupported = renderHook(() =>
      createLocalDictation({ language: 'en-US', onConfirm: vi.fn() })
    );
    expect(unsupported.result.phase()).toBe('unavailable');
    expect(unsupported.result.disabled()).toBe(true);
    Recognition.available.mockResolvedValue('unavailable');
    const unavailable = renderHook(() =>
      createLocalDictation({
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
    const confirmed = result.confirm();
    expect(speech.stop).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    speech.result('The corrected sentence.', 'Another thought.');
    speech.onend?.();
    await confirmed;
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
    const confirmed = result.confirm();
    result.cancel();
    await confirmed;
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
    await result.confirm();
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith('Keep this');
  });

  it('releases the recognizer on unmount and ignores a late end', async () => {
    const { result, cleanup, onConfirm } = await setup();
    await result.start();
    const speech = Recognition.latest;
    speech.result('do not insert after navigation');
    const confirmed = result.confirm();
    cleanup();
    await confirmed;
    speech.onend?.();
    expect(speech.abort).toHaveBeenCalledOnce();
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
    await result.confirm();
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

  it('commits on a second confirm when a browser never emits end', async () => {
    const { result, onConfirm } = await setup();
    await result.start();
    Recognition.latest.result('Last available words');
    const first = result.confirm();
    expect(result.phase()).toBe('finishing');
    expect(onConfirm).not.toHaveBeenCalled();
    const second = result.confirm();
    await Promise.all([first, second]);
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith('Last available words');
    expect(Recognition.latest.abort).toHaveBeenCalledOnce();
    expect(result.phase()).toBe('idle');
  });
});

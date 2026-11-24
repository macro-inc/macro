import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import type { Span } from '@macro-inc/observability';
import { createEffect, createSignal, onCleanup } from 'solid-js';
import type {
  CreateRecorder,
  RecorderHandle,
  TranscribeAudio,
} from '../core/recording';
import {
  ACTIVE_PHASES,
  type DictationController,
  type DictationMessageTone,
  type DictationPhase,
  FEEDBACK_MS,
} from '../core/types';
import { appendLevel, type VolumeLevel } from '../core/volume';

/**
 * Record in memory and upload to Whisper only on confirm. Cancel never
 * uploads, and a response that arrives after cancel never edits the draft.
 */
export function createRecordedDictation(options: {
  supported: boolean;
  startTrace: () => Pick<Span, 'event' | 'run' | 'setAttr' | 'error' | 'end'>;
  createRecorder: CreateRecorder;
  transcribe: TranscribeAudio;
  onConfirm: (text: string) => void;
  onCancel?: () => void;
  /** Monotonic milliseconds, for the elapsed time. */
  now?: () => number;
}): DictationController {
  const now = options.now ?? (() => performance.now());
  const [phase, setPhase] = createSignal<DictationPhase>(
    options.supported ? 'idle' : 'unavailable'
  );
  const [message, setMessageText] = createSignal('');
  const [messageTone, setMessageTone] =
    createSignal<DictationMessageTone>('info');
  const setMessage = (text: string, tone: DictationMessageTone = 'info') => {
    setMessageText(text);
    setMessageTone(tone);
  };
  const [elapsedMs, setElapsedMs] = createSignal(0);
  const [limitReached, setLimitReached] = createSignal(false);
  let startedAt = 0;
  const [volumeHistory, setVolumeHistory] = createSignal<
    readonly VolumeLevel[]
  >([]);
  let recorder: RecorderHandle | undefined;
  let audio: Blob | undefined;
  let upload: AbortController | undefined;
  let commitOnStop = false;
  let pendingConfirm: (() => void) | undefined;
  let disposed = false;
  let trace: ReturnType<typeof options.startTrace> | undefined;
  let attempt = 0;

  const endTrace = (outcome: string) => {
    trace?.setAttr('dictation.outcome', outcome);
    trace?.end();
    trace = undefined;
  };

  const active = () => ACTIVE_PHASES.includes(phase());

  const settleConfirm = () => {
    pendingConfirm?.();
    pendingConfirm = undefined;
  };

  const reset = (next: DictationPhase) => {
    upload?.abort();
    upload = undefined;
    recorder?.cancel();
    recorder = undefined;
    audio = undefined;
    commitOnStop = false;
    setLimitReached(false);
    setVolumeHistory([]);
    setPhase(next);
  };

  const transcribe = async (blob: Blob) => {
    if (upload) return;
    const current = new AbortController();
    upload = current;
    setPhase('finishing');
    setMessage('');
    trace?.event('dictation.upload_started', {
      attempt: ++attempt,
      audioBytes: blob.size,
    });
    try {
      const request = () => options.transcribe(blob, current.signal, trace);
      const text = (await (trace ? trace.run(request) : request())).trim();
      if (current.signal.aborted || disposed) return;
      upload = undefined;
      endTrace(text ? 'success' : 'empty_transcript');
      reset('idle');
      setMessage(text ? '' : t('dictation.noSpeech'));
      if (text) options.onConfirm(text);
      else options.onCancel?.();
    } catch (error) {
      if (current.signal.aborted || disposed) return;
      upload = undefined;
      trace?.event('dictation.upload_failed', { attempt });
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : t('dictation.transcriptionFailed'),
        'error'
      );
      // Keep the recording so the checkmark retries without re-recording.
      setPhase('review');
    } finally {
      if (!current.signal.aborted) settleConfirm();
    }
  };

  const onRecording = (blob: Blob) => {
    recorder = undefined;
    if (disposed) return;
    setElapsedMs(now() - startedAt);
    trace?.event('dictation.recording_stopped', { audioBytes: blob.size });
    if (!blob.size) {
      endTrace('empty_audio');
      reset('idle');
      setMessage(t('dictation.noAudio'), 'error');
      settleConfirm();
      return;
    }
    audio = blob;
    if (commitOnStop) {
      commitOnStop = false;
      fireAndForget(transcribe(blob), 'dictation');
      return;
    }
    setPhase('review');
    setMessage(limitReached() ? t('dictation.limitNotice') : '');
  };

  const start = async () => {
    if (phase() !== 'idle' || disposed) return;
    trace = options.startTrace();
    attempt = 0;
    setVolumeHistory([]);
    setElapsedMs(0);
    setPhase('starting');
    setMessage('');
    const current = options.createRecorder({
      onLevel: (level) => {
        if (recorder !== current || phase() !== 'listening') return;
        setElapsedMs(now() - startedAt);
        setVolumeHistory((history) => appendLevel(history, level));
      },
      onRecording: (blob) => {
        if (recorder === current) onRecording(blob);
      },
      onLimit: () => {
        if (recorder === current) {
          setLimitReached(true);
          trace?.event('dictation.recording_limit');
        }
      },
      onError: (error) => {
        if (recorder !== current) return;
        trace?.error('recording_error');
        endTrace('recording_error');
        reset('idle');
        setMessage(error.message, 'error');
        settleConfirm();
      },
      onInterrupted: () => {
        if (recorder !== current) return;
        endTrace('interrupted');
        reset('idle');
        setMessage(t('dictation.moved'));
        settleConfirm();
      },
    });
    recorder = current;
    try {
      await current.start();
      if (disposed || recorder !== current) {
        current.cancel();
        return;
      }
      startedAt = now();
      setPhase('listening');
      trace?.event('dictation.recording_started');
    } catch {
      if (disposed || recorder !== current) return;
      trace?.error('microphone_error');
      endTrace('microphone_error');
      reset('idle');
      setMessage(t('dictation.microphoneFailed'), 'error');
    }
  };

  const confirm = () =>
    new Promise<void>((resolve) => {
      if (phase() === 'review' && audio) {
        trace?.event('dictation.confirmed');
        pendingConfirm = resolve;
        fireAndForget(transcribe(audio), 'dictation');
        return;
      }
      if (phase() === 'listening' && recorder) {
        trace?.event('dictation.confirmed');
        pendingConfirm = resolve;
        commitOnStop = true;
        setPhase('finishing');
        recorder.stop();
        return;
      }
      resolve();
    });

  const cancel = () => {
    if (!active()) return;
    endTrace('cancelled');
    reset('idle');
    setMessage('');
    options.onCancel?.();
    settleConfirm();
  };

  // A note under the composer is about the last attempt; it goes stale.
  createEffect(() => {
    if (!message() || active()) return;
    const timer = setTimeout(() => setMessage(''), FEEDBACK_MS);
    onCleanup(() => clearTimeout(timer));
  });

  onCleanup(() => {
    disposed = true;
    endTrace('disposed');
    reset('idle');
    settleConfirm();
  });

  return {
    phase,
    active,
    volumeHistory,
    elapsedMs,
    limitReached,
    message,
    messageTone,
    clearMessage: () => setMessage(''),
    start,
    cancel,
    confirm,
    disabled: () => phase() !== 'idle',
    label: () =>
      options.supported ? t('dictation.start') : t('dictation.unavailable'),
  };
}

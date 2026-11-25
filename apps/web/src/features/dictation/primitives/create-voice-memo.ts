import { fireAndForget } from '@core/util/fireAndForget';
import type { Span } from '@macro-inc/observability';
import { createEffect, createSignal, onCleanup } from 'solid-js';
import type { CreateRecorder, RecorderHandle } from '../core/recording';
import { FEEDBACK_MS } from '../core/types';
import {
  type VoiceMemoController,
  type VoiceMemoNotice,
  type VoiceMemoPhase,
  voiceMemoFile,
} from '../core/voice-memo';
import { appendLevel, type VolumeLevel } from '../core/volume';

type VoiceMemoTrace = Pick<Span, 'event' | 'setAttr' | 'error' | 'end'> & {
  span<T>(
    name: string,
    operation: (span: Pick<Span, 'setAttr'>) => Promise<T>
  ): Promise<T>;
};

const ACTIVE_PHASES: readonly VoiceMemoPhase[] = [
  'starting',
  'recording',
  'attaching',
  'failed',
];

/** Map a getUserMedia rejection to what the person can do about it. */
function microphoneNotice(error: unknown): VoiceMemoNotice {
  if (!(error instanceof DOMException)) return 'microphone_failed';
  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
    return 'microphone_denied';
  }
  if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
    return 'microphone_missing';
  }
  return 'microphone_failed';
}

/**
 * Record audio in memory and hand it to `attach` as one file on stop. Cancel
 * never attaches, and a recording whose attach failed is kept for a retry
 * until it is attached or discarded.
 */
export function createVoiceMemo(options: {
  supported: boolean;
  startTrace: () => VoiceMemoTrace;
  createRecorder: CreateRecorder;
  /** Monotonic milliseconds, for the elapsed time. */
  now: () => number;
  /** The attached file's name, without its extension. */
  fileName: () => string;
  /** Upload and attach the file to the draft; its static file id, or none. */
  attach: (file: File) => Promise<string | undefined>;
  /** The panel closed: attached, discarded, or ended with a notice. */
  onFinish?: () => void;
}): VoiceMemoController {
  const [phase, setPhase] = createSignal<VoiceMemoPhase>(
    options.supported ? 'idle' : 'unavailable'
  );
  const [notice, setNotice] = createSignal<VoiceMemoNotice>();
  const [elapsedMs, setElapsedMs] = createSignal(0);
  const [volumeHistory, setVolumeHistory] = createSignal<
    readonly VolumeLevel[]
  >([]);
  let recorder: RecorderHandle | undefined;
  let recording: File | undefined;
  let startedAt = 0;
  let limitReached = false;
  let disposed = false;
  let trace: VoiceMemoTrace | undefined;
  let stopWaiters: (() => void)[] = [];

  const active = () => ACTIVE_PHASES.includes(phase());

  const settleStop = () => {
    const waiters = stopWaiters;
    stopWaiters = [];
    for (const resolve of waiters) resolve();
  };

  const endTrace = (outcome: string) => {
    trace?.setAttr('voice_memo.outcome', outcome);
    trace?.end();
    trace = undefined;
  };

  const reset = (next: VoiceMemoPhase) => {
    recorder?.cancel();
    recorder = undefined;
    recording = undefined;
    limitReached = false;
    setVolumeHistory([]);
    setPhase(next);
    settleStop();
  };

  /** End the attempt without a recording to keep. */
  const abandon = (outcome: VoiceMemoNotice) => {
    endTrace(outcome);
    reset('idle');
    setNotice(outcome);
    options.onFinish?.();
  };

  const attach = async (file: File) => {
    recording = file;
    setPhase('attaching');
    setNotice(undefined);
    trace?.event('voice_memo.attach_started', { audioBytes: file.size });
    // The browser drops the active context at the first await, so the upload
    // span parents explicitly on the session.
    const upload = async (span?: Pick<Span, 'setAttr'>) => {
      const staticFileId = await options.attach(file);
      span?.setAttr('voice_memo.attached', !!staticFileId);
      if (staticFileId) span?.setAttr('static_file.id', staticFileId);
      return !!staticFileId;
    };
    let attached = false;
    try {
      attached = await (trace
        ? trace.span('voice_memo.upload', upload)
        : upload());
    } catch (error) {
      // A thrown upload is a failed one: keep the recording for a retry.
      trace?.error(error);
    }
    // Cancelled or unmounted while uploading: the draft has moved on.
    if (disposed || recording !== file) return;

    if (!attached) {
      trace?.event('voice_memo.attach_failed');
      setPhase('failed');
      setNotice('upload_failed');
      settleStop();
      return;
    }

    const stoppedAtLimit = limitReached;
    endTrace('attached');
    reset('idle');
    setNotice(stoppedAtLimit ? 'limit' : undefined);
    options.onFinish?.();
  };

  const onRecording = (audio: Blob) => {
    recorder = undefined;
    const durationMs = options.now() - startedAt;
    setElapsedMs(durationMs);
    trace?.event('voice_memo.recording_stopped', {
      audioBytes: audio.size,
      durationMs,
    });
    if (!audio.size) {
      abandon('empty');
      return;
    }
    return attach(voiceMemoFile(audio, options.fileName()));
  };

  const start = async () => {
    if (phase() !== 'idle' || disposed) return;
    trace = options.startTrace();
    setNotice(undefined);
    setElapsedMs(0);
    setVolumeHistory([]);
    setPhase('starting');

    const current = options.createRecorder({
      onLevel: (level) => {
        if (recorder !== current || phase() !== 'recording') return;
        setElapsedMs(options.now() - startedAt);
        setVolumeHistory((history) => appendLevel(history, level));
      },
      onRecording: (audio) => {
        if (recorder !== current || disposed) return;
        const attaching = onRecording(audio);
        if (attaching) fireAndForget(attaching, 'voice-memo');
      },
      onLimit: () => {
        if (recorder !== current) return;
        limitReached = true;
        trace?.event('voice_memo.recording_limit');
      },
      onError: () => {
        if (recorder !== current) return;
        trace?.error('recording_error');
        abandon('recording_failed');
      },
      onInterrupted: () => {
        if (recorder !== current) return;
        abandon('interrupted');
      },
    });
    recorder = current;

    try {
      await current.start();
    } catch (error) {
      if (disposed || recorder !== current) return;
      recorder = undefined;
      abandon(microphoneNotice(error));
      return;
    }

    // Cancelled while the permission prompt was open: the grant arrives late.
    if (disposed || recorder !== current) {
      current.cancel();
      return;
    }
    startedAt = options.now();
    setPhase('recording');
    trace?.event('voice_memo.recording_started');
  };

  const stop = () =>
    new Promise<void>((resolve) => {
      if (phase() === 'recording' && recorder) {
        stopWaiters.push(resolve);
        recorder.stop();
        return;
      }
      if (phase() === 'attaching') {
        stopWaiters.push(resolve);
        return;
      }
      resolve();
    });

  const retry = async () => {
    if (phase() !== 'failed' || !recording) return;
    await attach(recording);
  };

  // An upload in flight finishes into the draft; the person removes it there.
  const cancel = () => {
    if (!active() || phase() === 'attaching') return;
    endTrace('cancelled');
    reset('idle');
    setNotice(undefined);
    options.onFinish?.();
  };

  // A notice is about the last attempt; it goes stale.
  createEffect(() => {
    if (!notice() || active()) return;
    const timer = setTimeout(() => setNotice(undefined), FEEDBACK_MS);
    onCleanup(() => clearTimeout(timer));
  });

  onCleanup(() => {
    disposed = true;
    endTrace('disposed');
    reset('idle');
  });

  return {
    phase,
    active,
    volumeHistory,
    elapsedMs,
    notice,
    clearNotice: () => setNotice(undefined),
    disabled: () => phase() !== 'idle',
    start,
    stop,
    retry,
    cancel,
  };
}

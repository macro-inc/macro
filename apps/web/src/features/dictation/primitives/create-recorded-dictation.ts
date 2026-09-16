import { createSignal, onCleanup } from 'solid-js';
import type {
  AudioRecording,
  StartRecording,
  TranscribeAudio,
} from '../core/recording';
import type { DictationController, DictationPhase } from '../core/types';
import { MAX_VOLUME_SAMPLES } from '../core/volume';

/** Cloud fallback: cancel never uploads, and late responses never edit a draft. */
export function createRecordedDictation(options: {
  supported: boolean;
  startRecording: StartRecording;
  transcribe: TranscribeAudio;
  onConfirm: (text: string) => void;
  onCancel?: () => void;
}): DictationController {
  const [phase, setPhase] = createSignal<DictationPhase>(
    options.supported ? 'idle' : 'unavailable'
  );
  const [message, setMessage] = createSignal('');
  const [volumeHistory, setVolumeHistory] = createSignal<readonly number[]>([]);
  let session: AbortController | undefined;
  let recording: AudioRecording | undefined;
  let audio: Blob | undefined;
  let disposed = false;
  const active = () =>
    ['starting', 'listening', 'finishing', 'review'].includes(phase());
  const release = () => {
    session?.abort();
    session = undefined;
    recording?.cancel();
    recording = undefined;
    audio = undefined;
    setVolumeHistory([]);
  };
  const finish = async (upload: boolean) => {
    if (!['listening', 'review'].includes(phase()) || !session) return;
    const current = session;
    setPhase('finishing');
    try {
      if (!audio) audio = await recording?.finish();
      recording = undefined;
      if (current.signal.aborted) return;
      if (!audio?.size)
        throw new Error('No audio was recorded. Please try again.');
      if (!upload) {
        setPhase('review');
        setMessage(
          'Recording stopped. Select the checkmark to transcribe with OpenAI.'
        );
        return;
      }
      setMessage('Transcribing with OpenAI…');
      const text = (await options.transcribe(audio, current.signal)).trim();
      if (current.signal.aborted || disposed) return;
      release();
      setPhase('idle');
      setMessage(text ? '' : 'No speech was detected. Try again.');
      if (text) options.onConfirm(text);
      else options.onCancel?.();
    } catch (error) {
      if (current.signal.aborted || disposed) return;
      setMessage(
        error instanceof Error
          ? error.message
          : 'Transcription failed. Please try again.'
      );
      if (audio?.size) setPhase('review');
      else {
        release();
        setPhase('idle');
      }
    }
  };
  const start = async () => {
    if (phase() !== 'idle' || disposed) return;
    const current = new AbortController();
    session = current;
    setVolumeHistory([]);
    setPhase('starting');
    setMessage('Audio is sent to OpenAI Whisper only when you confirm.');
    try {
      const started = await options.startRecording({
        signal: current.signal,
        onLevel: (level) => {
          if (!current.signal.aborted && phase() === 'listening') {
            setVolumeHistory((history) => [
              ...history.slice(-(MAX_VOLUME_SAMPLES - 1)),
              level,
            ]);
          }
        },
        onLimit: () => {
          if (!current.signal.aborted) void finish(false);
        },
      });
      if (current.signal.aborted || disposed) {
        started.cancel();
        return;
      }
      recording = started;
      setPhase('listening');
    } catch {
      if (current.signal.aborted || disposed) return;
      release();
      setPhase('idle');
      setMessage(
        'Could not access your microphone. Check permissions and try again.'
      );
    }
  };
  const cancel = () => {
    if (!active()) return;
    release();
    setPhase('idle');
    setMessage('');
    options.onCancel?.();
  };
  onCleanup(() => {
    disposed = true;
    release();
  });
  return {
    phase,
    active,
    volumeHistory,
    message,
    start,
    cancel,
    transcript: () => '',
    confirm: () => {
      void finish(true);
    },
    disabled: () => phase() !== 'idle',
    label: () =>
      options.supported
        ? 'Start dictation with OpenAI Whisper'
        : 'Dictation is unavailable in this browser',
  };
}

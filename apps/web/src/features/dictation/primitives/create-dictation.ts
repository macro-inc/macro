import { createSignal, onCleanup, onMount } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  DictationController,
  DictationPhase,
  LocalSpeechConstructor,
  LocalSpeechRecognition,
  SpeechAvailability,
  StartVolumeMeter,
} from '../core/types';
import { MAX_VOLUME_SAMPLES } from '../core/volume';

export function createDictation(options: {
  recognition?: LocalSpeechConstructor;
  language: string;
  startVolumeMeter?: StartVolumeMeter;
  onConfirm: (text: string) => void;
  onCancel?: () => void;
}): DictationController {
  const [phase, setPhase] = createSignal<DictationPhase>('checking');
  const [availability, setAvailability] =
    createSignal<SpeechAvailability>('unavailable');
  const [transcript, setTranscript] = createSignal('');
  const [volumeHistory, setVolumeHistory] = createSignal<readonly number[]>([]);
  const [message, setMessage] = createSignal('');
  const localOptions = {
    langs: [options.language],
    processLocally: true as const,
  };
  let recognition: LocalSpeechRecognition | undefined;
  let disposed = false;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let volumeMeter: ReturnType<StartVolumeMeter> | undefined;

  const stopVolumeMeter = () => {
    volumeMeter?.stop();
    volumeMeter = undefined;
  };

  const active = () =>
    ['starting', 'listening', 'finishing', 'review'].includes(phase());

  const release = () => {
    clearTimeout(finishTimer);
    stopVolumeMeter();
    const current = recognition;
    recognition = undefined;
    if (!current) return;
    current.onstart = current.onend = current.onerror = current.onresult = null;
    current.abort();
  };

  const checkAvailability = async () => {
    if (!options.recognition) {
      setPhase('unavailable');
      return;
    }
    try {
      const available = await options.recognition.available(localOptions);
      if (disposed) return;
      setAvailability(available);
      setPhase(available === 'unavailable' ? 'unavailable' : 'idle');
    } catch {
      if (!disposed) setPhase('unavailable');
    }
  };

  const commit = () => {
    const text = transcript().trim();
    release();
    setPhase(availability() === 'unavailable' ? 'unavailable' : 'idle');
    setTranscript('');
    setVolumeHistory([]);
    setMessage('');
    if (text) options.onConfirm(text);
    else options.onCancel?.();
  };

  const start = async () => {
    const Recognition = options.recognition;
    if (!Recognition || phase() !== 'idle' || disposed) return;
    setMessage('');
    if (availability() !== 'available') {
      setPhase('installing');
      try {
        const installed = await Recognition.install(localOptions);
        if (disposed) return;
        if (!installed) {
          setMessage('The speech language download failed. Try again.');
          setPhase('unavailable');
          return;
        }
        setAvailability('available');
        setMessage('Ready. Select the microphone to start dictation.');
      } catch {
        if (disposed) return;
        setMessage('The speech language download failed. Try again.');
        setPhase('unavailable');
        return;
      }
      // Starting recording needs a fresh user gesture after the download.
      setPhase('idle');
      return;
    }

    setTranscript('');
    setVolumeHistory([]);
    setPhase('starting');
    try {
      const current = new Recognition();
      recognition = current;
      current.processLocally = true;
      current.lang = options.language;
      current.continuous = true;
      current.interimResults = true;
      current.onstart = () => setPhase('listening');
      current.onresult = (event) => {
        // Results contain the complete session, including corrected interim
        // hypotheses. Replacing avoids duplicating words on every event.
        setTranscript(
          Array.from(event.results, (result) => result[0].transcript.trim())
            .filter(Boolean)
            .join(' ')
        );
      };
      current.onerror = (event) => {
        const text = match(event.error)
          .with(
            'not-allowed',
            'service-not-allowed',
            () =>
              'Microphone access was denied. Allow it in your browser to dictate.'
          )
          .with(
            'audio-capture',
            () =>
              'No microphone is available. Check your microphone and try again.'
          )
          .with('no-speech', () => 'No speech was detected. Try again.')
          .with(
            'language-not-supported',
            () =>
              'On-device dictation is unavailable for your browser language.'
          )
          .otherwise(
            () => 'Dictation stopped. You can keep the text or try again.'
          );
        release();
        setMessage(text);
        setPhase(transcript().trim() ? 'review' : 'idle');
        if (event.error === 'language-not-supported') {
          setAvailability('unavailable');
          if (!transcript().trim()) setPhase('unavailable');
        }
      };
      current.onend = () => {
        const shouldCommit = phase() === 'finishing';
        release();
        if (shouldCommit) commit();
        else if (transcript().trim()) setPhase('review');
        else {
          setMessage('No speech was detected. Try again.');
          setPhase('idle');
        }
      };
      current.start();
      if (recognition === current) {
        volumeMeter = options.startVolumeMeter?.(
          (level) => {
            if (recognition !== current || phase() !== 'listening') return;
            setVolumeHistory((history) => [
              ...history.slice(-(MAX_VOLUME_SAMPLES - 1)),
              level,
            ]);
          },
          () => {
            if (recognition === current) {
              setMessage(
                'Microphone volume is unavailable. You can still dictate.'
              );
            }
          }
        );
      }
    } catch {
      release();
      setMessage(
        'Could not start on-device dictation. Check microphone permissions and try again.'
      );
      setPhase('unavailable');
    }
  };

  const confirm = () => {
    if (phase() === 'review') return commit();
    if (phase() !== 'listening' || !recognition) return;
    setPhase('finishing');
    stopVolumeMeter();
    // Wait for the final result emitted after stop; bound browsers that fail
    // to emit end so the composer can never get stuck recording.
    finishTimer = setTimeout(commit, 3000);
    try {
      recognition.stop();
    } catch {
      commit();
    }
  };

  const cancel = () => {
    if (!active()) return;
    release();
    setTranscript('');
    setVolumeHistory([]);
    setMessage('');
    setPhase(availability() === 'unavailable' ? 'unavailable' : 'idle');
    options.onCancel?.();
  };

  onMount(() => void checkAvailability());
  onCleanup(() => {
    disposed = true;
    release();
  });

  return {
    phase,
    active,
    volumeHistory,
    transcript,
    message,
    start,
    confirm,
    cancel,
    disabled: () => phase() !== 'idle',
    label: () =>
      match(phase())
        .with('checking', () => 'Checking on-device dictation…')
        .with(
          'unavailable',
          () => 'On-device dictation is unavailable in this browser or language'
        )
        .with('installing', () => 'Downloading speech language…')
        .otherwise(() =>
          availability() === 'available'
            ? 'Start dictation'
            : 'Download language for on-device dictation'
        ),
  };
}

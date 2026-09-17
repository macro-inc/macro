import { createSignal, onCleanup, onMount } from 'solid-js';
import { match } from 'ts-pattern';
import type { CreateRecorder, RecorderHandle } from '../core/recording';
import {
  ACTIVE_PHASES,
  type DictationController,
  type DictationPhase,
  type LocalSpeechConstructor,
  type LocalSpeechRecognition,
  type SpeechAvailability,
} from '../core/types';
import { appendLevel, type VolumeLevel } from '../core/volume';

/**
 * On-device dictation through the local-only Web Speech API. The optional
 * recorder runs as a microphone meter for the volume timeline; speech
 * recognition captures audio on its own.
 */
export function createLocalDictation(options: {
  recognition?: LocalSpeechConstructor;
  language: string;
  createRecorder?: CreateRecorder;
  onConfirm: (text: string) => void;
  onCancel?: () => void;
}): DictationController {
  const [phase, setPhase] = createSignal<DictationPhase>('checking');
  const [availability, setAvailability] =
    createSignal<SpeechAvailability>('unavailable');
  const [transcript, setTranscript] = createSignal('');
  const [volumeHistory, setVolumeHistory] = createSignal<
    readonly VolumeLevel[]
  >([]);
  const [message, setMessage] = createSignal('');
  const localOptions = {
    langs: [options.language],
    processLocally: true as const,
  };
  let recognition: LocalSpeechRecognition | undefined;
  let meter: RecorderHandle | undefined;
  let disposed = false;
  let pendingConfirm: (() => void) | undefined;

  const active = () => ACTIVE_PHASES.includes(phase());
  const restingPhase = () =>
    availability() === 'unavailable' ? 'unavailable' : 'idle';

  const settleConfirm = () => {
    pendingConfirm?.();
    pendingConfirm = undefined;
  };

  const stopMeter = () => {
    meter?.cancel();
    meter = undefined;
  };

  const release = () => {
    stopMeter();
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
    setPhase(restingPhase());
    setTranscript('');
    setVolumeHistory([]);
    setMessage('');
    if (text) options.onConfirm(text);
    else options.onCancel?.();
    settleConfirm();
  };

  const startMeter = (current: LocalSpeechRecognition) => {
    if (!options.createRecorder) return;
    const recorder = options.createRecorder({
      onLevel: (level) => {
        if (recognition === current && phase() === 'listening')
          setVolumeHistory((history) => appendLevel(history, level));
      },
      onError: () => {
        if (recognition === current)
          setMessage(
            'Microphone volume is unavailable. You can still dictate.'
          );
      },
    });
    meter = recorder;
    const begin = async () => {
      try {
        await recorder.start();
      } catch {
        if (recognition === current)
          setMessage(
            'Microphone volume is unavailable. You can still dictate.'
          );
      }
    };
    void begin();
  };

  const install = async (Recognition: LocalSpeechConstructor) => {
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
      // Starting recognition needs a fresh user gesture after the download.
      setPhase('idle');
    } catch {
      if (disposed) return;
      setMessage('The speech language download failed. Try again.');
      setPhase('unavailable');
    }
  };

  const start = async () => {
    const Recognition = options.recognition;
    if (!Recognition || phase() !== 'idle' || disposed) return;
    setMessage('');
    if (availability() !== 'available') return install(Recognition);

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
        if (phase() !== 'review') settleConfirm();
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
      if (recognition === current) startMeter(current);
    } catch {
      release();
      setMessage(
        'Could not start on-device dictation. Check microphone permissions and try again.'
      );
      setPhase('unavailable');
    }
  };

  const confirm = () =>
    new Promise<void>((resolve) => {
      match(phase())
        .with('review', () => {
          pendingConfirm = resolve;
          commit();
        })
        .with('listening', () => {
          if (!recognition) return resolve();
          pendingConfirm = resolve;
          setPhase('finishing');
          stopMeter();
          // The final, corrected result arrives before `onend`, which commits.
          try {
            recognition.stop();
          } catch {
            commit();
          }
        })
        .with('finishing', () => {
          // A browser that never emits `onend` would otherwise strand the user;
          // confirming again commits whatever has been recognized so far.
          const previous = pendingConfirm;
          pendingConfirm = () => {
            previous?.();
            resolve();
          };
          commit();
        })
        .otherwise(() => resolve());
    });

  const cancel = () => {
    if (!active()) return;
    release();
    setTranscript('');
    setVolumeHistory([]);
    setMessage('');
    setPhase(restingPhase());
    options.onCancel?.();
    settleConfirm();
  };

  onMount(() => void checkAvailability());
  onCleanup(() => {
    disposed = true;
    release();
    settleConfirm();
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

import type { StartVolumeMeter } from './core/types';
import { microphoneLevel, VOLUME_INTERVAL_MS } from './core/volume';

/** Local amplitude analysis only: no recording, playback, or audio upload. */
export const startMicrophoneVolume = (
  onLevel: Parameters<StartVolumeMeter>[0],
  onError: Parameters<StartVolumeMeter>[1],
  inputStream?: MediaStream
) => {
  let stopped = false;
  let context: AudioContext | undefined;
  let stream: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let analyser: AnalyserNode | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const closeContext = async (audio: AudioContext) => {
    try {
      await audio.close();
    } catch {
      // A browser may already have closed the context during navigation.
    }
  };

  const stop = () => {
    stopped = true;
    clearInterval(timer);
    source?.disconnect();
    analyser?.disconnect();
    // A recorder owns a supplied stream; losing the meter must not stop it.
    if (!inputStream) stream?.getTracks().forEach((track) => track.stop());
    if (context) void closeContext(context);
    context = undefined;
    stream = undefined;
    source = undefined;
    analyser = undefined;
  };

  const start = async () => {
    try {
      // Construct/resume during the microphone button's user gesture.
      const audio = new AudioContext();
      context = audio;
      await audio.resume();
      if (stopped) return;
      const input =
        inputStream ??
        (await navigator.mediaDevices.getUserMedia({ audio: true }));
      if (stopped) {
        if (!inputStream) input.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = input;
      const meter = audio.createAnalyser();
      analyser = meter;
      meter.fftSize = 2048;
      source = audio.createMediaStreamSource(input);
      source.connect(meter);
      // Deliberately not connected to the destination: never play the mic back.
      const samples = new Float32Array(meter.fftSize);
      let peak = 0;
      let ticks = 0;
      timer = setInterval(() => {
        meter.getFloatTimeDomainData(samples);
        peak = Math.max(peak, microphoneLevel(samples));
        if (++ticks < 4) return;
        onLevel(peak);
        peak = 0;
        ticks = 0;
      }, VOLUME_INTERVAL_MS / 4);
    } catch {
      const reportError = !stopped;
      stop();
      if (reportError) onError();
    }
  };

  void start();
  return { stop };
};

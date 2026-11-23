import { backgroundProcessorOptions } from '@core/media/background-effect';
import { fireAndForget } from '@core/util/fireAndForget';
import type { MeetingMediaAccess } from '../primitives/meeting-media';

/**
 * WebKit leaves `navigator.mediaDevices` undefined in insecure contexts and in
 * apps whose Info.plist lacks camera and microphone usage strings.
 */
const mediaDevicesUnavailable = () =>
  Promise.reject(
    new DOMException('Media devices are unavailable', 'NotSupportedError')
  );

const SILENCE_DB = -60;

/** Maps RMS loudness onto 0–1 across the last 60 dB, roughly as ears hear it. */
export function inputLevel(samples: Float32Array) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length);
  if (rms === 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db - SILENCE_DB) / -SILENCE_DB));
}

/** Preview processors own a clone, so disposal never stops the join track. */
export const browserMeetingMedia: MeetingMediaAccess = {
  request: (constraints) =>
    navigator.mediaDevices?.getUserMedia(constraints) ??
    mediaDevicesUnavailable(),
  enumerate: () =>
    navigator.mediaDevices?.enumerateDevices() ?? mediaDevicesUnavailable(),
  onDeviceChange: (refresh) => {
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () =>
      navigator.mediaDevices?.removeEventListener('devicechange', refresh);
  },
  canSelectSpeaker: () => 'setSinkId' in HTMLMediaElement.prototype,
  monitorLevel: (stream, onLevel) => {
    const track = stream.getAudioTracks()[0]?.clone();
    if (!track || typeof AudioContext === 'undefined') return () => {};
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    // getUserMedia counts as activation for autoplay, but a context made
    // before it settles can still start suspended.
    if (context.state === 'suspended')
      fireAndForget(context.resume(), 'meeting-media');
    const samples = new Float32Array(analyser.fftSize);
    let frame = requestAnimationFrame(function sample() {
      analyser.getFloatTimeDomainData(samples);
      onLevel(inputLevel(samples));
      frame = requestAnimationFrame(sample);
    });
    return () => {
      cancelAnimationFrame(frame);
      track.stop();
      fireAndForget(context.close(), 'meeting-media');
    };
  },
  processBackground: async (track, effect) => {
    const [
      { LocalVideoTrack },
      { BackgroundProcessor, supportsBackgroundProcessors },
    ] = await Promise.all([
      import('livekit-client'),
      import('@livekit/track-processors'),
    ]);
    if (!supportsBackgroundProcessors())
      throw new Error('Background effects aren’t supported in this browser.');
    const camera = new LocalVideoTrack(
      track.clone(),
      track.getConstraints(),
      false
    );
    try {
      await camera.setProcessor(
        BackgroundProcessor(backgroundProcessorOptions(effect))
      );
      return {
        stream: new MediaStream([camera.mediaStreamTrack]),
        dispose: () => camera.stop(),
      };
    } catch (error) {
      camera.stop();
      throw error;
    }
  },
};

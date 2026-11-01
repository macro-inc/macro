import { backgroundProcessorOptions } from '@core/media/background-effect';
import type { MeetingMediaAccess } from '../primitives/meeting-media';

/**
 * WebKit leaves `navigator.mediaDevices` undefined in insecure contexts and in
 * apps whose Info.plist lacks camera and microphone usage strings.
 */
const mediaDevicesUnavailable = () =>
  Promise.reject(
    new DOMException('Media devices are unavailable', 'NotSupportedError')
  );

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

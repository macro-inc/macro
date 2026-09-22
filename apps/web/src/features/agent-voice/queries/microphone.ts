import type { VoiceMicrophone } from '../core/types';

/** Ask on Start; device enumeration cannot establish microphone access. */
export async function requestVoiceMicrophone(): Promise<VoiceMicrophone> {
  if (globalThis.isSecureContext === false)
    throw new Error(
      'Microphone access requires a secure connection. Open Macro over HTTPS or localhost, then try again.'
    );
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error(
      'This browser cannot access your microphone. Open Macro in a current browser over HTTPS or localhost.'
    );

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (error) {
    const name =
      typeof error === 'object' && error !== null && 'name' in error
        ? error.name
        : undefined;
    if (name === 'NotAllowedError' || name === 'SecurityError')
      throw new Error(
        'Microphone access is blocked. Allow microphone access for Macro in your browser and system settings, then try again.'
      );
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError')
      throw new Error(
        'No microphone was found. Connect or enable a microphone, then try again.'
      );
    if (name === 'NotReadableError' || name === 'TrackStartError')
      throw new Error(
        'Your microphone could not start. Close other apps using it and check your system microphone settings, then try again.'
      );
    throw new Error(
      'Microphone access did not complete. Check your microphone and browser permissions, then try again.'
    );
  }

  const track = stream
    .getAudioTracks()
    .find((candidate) => candidate.readyState === 'live');
  if (!track) {
    for (const captured of stream.getTracks()) captured.stop();
    throw new Error(
      'Your microphone did not provide audio. Connect or enable a microphone, then try again.'
    );
  }
  for (const captured of stream.getTracks())
    if (captured !== track) captured.stop();
  let stopped = false;
  return {
    track,
    stop: () => {
      if (stopped) return;
      stopped = true;
      track.stop();
    },
  };
}

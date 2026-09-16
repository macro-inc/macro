import { startMicrophoneVolume } from './browser-volume';
import type { AudioRecording, StartRecording } from './core/recording';

export const MAX_RECORDING_BYTES = 8 * 1024 * 1024;
export const MAX_RECORDING_MS = 5 * 60 * 1000;
const MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

export function canRecordAudio() {
  return !!(
    window.isSecureContext &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined' &&
    MIME_TYPES.some((type) => MediaRecorder.isTypeSupported(type))
  );
}

/** Capture only in memory. Upload is a separate, explicitly confirmed operation. */
export const startRecording: StartRecording = async ({
  signal,
  onLevel,
  onLimit,
}) => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const stopTracks = () => stream.getTracks().forEach((track) => track.stop());
  if (signal.aborted) {
    stopTracks();
    throw new DOMException('Cancelled', 'AbortError');
  }
  let recorder: MediaRecorder;
  try {
    const mimeType = MIME_TYPES.find((type) =>
      MediaRecorder.isTypeSupported(type)
    );
    if (!mimeType) throw new Error('No supported recording format');
    recorder = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: 64_000,
    });
  } catch (error) {
    stopTracks();
    throw error;
  }

  let chunks: Blob[] = [];
  let size = 0;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolve: (blob: Blob) => void;
  let reject: (error: Error) => void;
  const result = new Promise<Blob>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // The browser may stop/error before the user confirms; retain that result.
  const observeResult = async () => {
    try {
      await result;
    } catch {
      // finish() delivers this error to the controller when it stops recording.
    }
  };
  void observeResult();
  const meter = startMicrophoneVolume(onLevel, () => {}, stream);
  const release = () => {
    clearTimeout(timer);
    meter.stop();
    stopTracks();
    signal.removeEventListener('abort', cancel);
  };
  const cancel = () => {
    cancelled = true;
    chunks = [];
    if (recorder.state !== 'inactive') recorder.stop();
    release();
    reject(new DOMException('Cancelled', 'AbortError'));
  };
  recorder.ondataavailable = ({ data }) => {
    if (cancelled || !data.size) return;
    size += data.size;
    if (size > MAX_RECORDING_BYTES) {
      reject(
        new Error('Recording exceeded 8 MB. Please record a shorter message.')
      );
      cancel();
      onLimit();
      return;
    }
    chunks.push(data);
    if (size >= MAX_RECORDING_BYTES - 64 * 1024) onLimit();
  };
  recorder.onerror = () => {
    reject(new Error('Audio recording failed. Please try again.'));
    if (recorder.state !== 'inactive') recorder.stop();
    release();
    onLimit();
  };
  recorder.onstop = () => {
    release();
    if (cancelled) return;
    resolve(new Blob(chunks, { type: recorder.mimeType }));
    chunks = [];
    onLimit();
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    recorder.start(250);
  } catch (error) {
    cancel();
    throw error;
  }
  timer = setTimeout(onLimit, MAX_RECORDING_MS);
  const recording: AudioRecording = {
    finish: () => {
      if (recorder.state !== 'inactive') recorder.stop();
      release();
      return result;
    },
    cancel,
  };
  return recording;
};

import type { BackgroundEffect } from '@core/media/background-effect';
import { createSignal, onCleanup } from 'solid-js';
import type { MeetingLocalTracks } from '../context/meeting-session';

export type MeetingMediaAccess = {
  request: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  enumerate?: () => Promise<MediaDeviceInfo[]>;
  onDeviceChange?: (refresh: () => void) => () => void;
  canSelectSpeaker?: () => boolean;
  processBackground?: (
    track: MediaStreamTrack,
    effect: BackgroundEffect
  ) => Promise<{
    stream: MediaStream;
    dispose: () => void;
  }>;
};

// Match LiveKit's capture quality when publishing preview tracks.
const CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
};

function errorName(error: unknown) {
  return error instanceof DOMException ? error.name : undefined;
}

function mediaErrorMessage(device: 'microphone' | 'camera', error: unknown) {
  const label = device === 'microphone' ? 'Microphone' : 'Camera';
  const retry = 'then turn it on to retry.';
  switch (errorName(error)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        permission: true,
        text: `${label} access is blocked. Allow it in your browser (and system) settings, ${retry}`,
      };
    case 'NotReadableError':
    case 'AbortError':
      return {
        permission: false,
        text: `${label} is in use by another app or tab. Close it, ${retry}`,
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return {
        permission: false,
        text: `No ${label.toLowerCase()} found. Connect one, ${retry}`,
      };
    default:
      return {
        permission: false,
        text: `${label} is unavailable. Check the device, ${retry}`,
      };
  }
}

/** Hand preview tracks to the call without reopening devices; release all others. */
export function createMeetingMedia(
  access?: MeetingMediaAccess,
  initialBackground: BackgroundEffect = { type: 'none' }
) {
  type Device = 'microphone' | 'camera';
  const devices: Device[] = ['microphone', 'camera'];
  const [microphoneEnabled, setMicrophone] = createSignal(true);
  const [cameraEnabled, setCamera] = createSignal(false);
  const [video, setVideo] = createSignal<MediaStream>();
  const [pending, setPending] = createSignal({
    microphone: false,
    camera: false,
  });
  const [errors, setErrors] = createSignal<Partial<Record<Device, string>>>({});
  const [availableDevices, setAvailableDevices] = createSignal<
    MediaDeviceInfo[]
  >([]);
  const [selectedDevices, setSelectedDevices] = createSignal({
    microphone: '',
    camera: '',
    speaker: '',
  });
  const [deviceError, setDeviceError] = createSignal<string>();
  const [backgroundEffect, setBackground] = createSignal<BackgroundEffect>(
    initialBackground.type === 'blur' &&
      initialBackground.intensity === 'medium'
      ? { type: 'blur', intensity: 'heavy' }
      : initialBackground
  );
  const [backgroundPending, setBackgroundPending] = createSignal(false);
  const [backgroundError, setBackgroundError] = createSignal<string>();
  let preview: { dispose: () => void } | undefined;
  let previewGeneration = 0;
  let enumerationGeneration = 0;
  let watchingDevices: (() => void) | undefined;
  const streams: Partial<Record<Device, MediaStream>> = {};
  const generations = { microphone: 0, camera: 0 };
  let disposed = false;
  let preparation = 0;
  const enabled = (device: Device) =>
    device === 'microphone' ? microphoneEnabled() : cameraEnabled();
  const setEnabled = (device: Device, value: boolean) =>
    device === 'microphone' ? setMicrophone(value) : setCamera(value);
  const setDevicePending = (device: Device, value: boolean) =>
    setPending((current) => ({ ...current, [device]: value }));
  const stop = (device: Device) => {
    generations[device]++;
    streams[device]?.getTracks().forEach((track) => track.stop());
    delete streams[device];
    if (device === 'camera') {
      previewGeneration++;
      preview?.dispose();
      preview = undefined;
      setVideo(undefined);
      setBackgroundPending(false);
    }
    setDevicePending(device, false);
  };
  async function refreshDevices() {
    if (!access?.enumerate || disposed) return;
    const generation = ++enumerationGeneration;
    try {
      const devices = await access.enumerate();
      if (disposed || generation !== enumerationGeneration) return;
      setAvailableDevices(devices);
      setDeviceError(undefined);
    } catch {
      if (!disposed && generation === enumerationGeneration)
        setDeviceError(
          'Could not list your devices. Check browser permissions and try again.'
        );
    }
  }
  async function updatePreview() {
    const generation = ++previewGeneration;
    preview?.dispose();
    preview = undefined;
    setBackgroundError(undefined);
    setBackgroundPending(false);
    const stream = streams.camera;
    const track = stream?.getVideoTracks()[0];
    if (!track || !cameraEnabled()) {
      setVideo(undefined);
      return;
    }
    const effect = backgroundEffect();
    if (effect.type === 'none') {
      setVideo(stream);
      return;
    }
    setVideo(undefined);
    setBackgroundPending(true);
    try {
      if (!access?.processBackground)
        throw new Error('Background effects are unavailable.');
      const processed = await access.processBackground(track, effect);
      if (disposed || generation !== previewGeneration) {
        processed.dispose();
        return;
      }
      preview = processed;
      setVideo(processed.stream);
    } catch (error) {
      if (disposed || generation !== previewGeneration) return;
      console.warn('[meeting] background preview failed', error);
      setBackgroundError(
        'Couldn’t apply the background. Your camera is off. Choose another background or None, then turn the camera on to retry.'
      );
      setCamera(false);
      stop('camera');
    } finally {
      if (!disposed && generation === previewGeneration)
        setBackgroundPending(false);
    }
  }
  const accept = (device: Device, stream: MediaStream) => {
    streams[device] = stream;
    const track = stream.getTracks()[0];
    const deviceId = track?.getSettings?.().deviceId;
    if (deviceId)
      setSelectedDevices((current) => ({ ...current, [device]: deviceId }));
    track?.addEventListener?.('ended', () => {
      if (streams[device] !== stream) return;
      setEnabled(device, false);
      stop(device);
      setErrors((current) => ({
        ...current,
        [device]: `${device === 'camera' ? 'Camera' : 'Microphone'} disconnected. Select a device and turn it on to retry.`,
      }));
      void refreshDevices();
    });
    if (device === 'camera') void updatePreview();
  };
  const captureConstraints = (device: Device) => {
    const deviceId = selectedDevices()[device];
    const selection = deviceId ? { deviceId: { exact: deviceId } } : {};
    return device === 'camera'
      ? { ...CAMERA_CONSTRAINTS, ...selection }
      : deviceId
        ? selection
        : true;
  };
  /** A camera that can't meet the preferred capture falls back to any mode. */
  async function open(device: Device) {
    if (!access) throw new Error('Media access is unavailable');
    if (device === 'microphone')
      return access.request({
        audio: captureConstraints(device),
        video: false,
      });
    try {
      return await access.request({
        audio: false,
        video: captureConstraints(device),
      });
    } catch (error) {
      if (errorName(error) !== 'OverconstrainedError') throw error;
      const deviceId = selectedDevices().camera;
      return access.request({
        audio: false,
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
    }
  }
  async function request(device: Device) {
    if (!access || disposed) return;
    stop(device);
    const generation = generations[device];
    setDevicePending(device, true);
    setErrors((current) => ({ ...current, [device]: undefined }));
    try {
      const stream = await open(device);
      if (disposed || generations[device] !== generation || !enabled(device)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      accept(device, stream);
      void refreshDevices();
    } catch (error) {
      if (disposed || generations[device] !== generation) return;
      console.warn(`[meeting] ${device} request failed`, error);
      const message = mediaErrorMessage(device, error);
      // Permission is requested for both devices up front, but a hardware
      // problem only matters for a device the user actually turned on.
      if (!enabled(device) && !message.permission) return;
      setEnabled(device, false);
      setErrors((current) => ({ ...current, [device]: message.text }));
    } finally {
      if (!disposed && generations[device] === generation)
        setDevicePending(device, false);
    }
  }
  /** Request both permissions once; retry missing devices for individual errors. */
  async function requestTogether(current: number): Promise<Device[]> {
    if (!access || disposed) return [];
    devices.forEach(stop);
    const started = { ...generations };
    const isCurrent = (device: Device) =>
      !disposed &&
      current === preparation &&
      generations[device] === started[device];
    setPending({ microphone: true, camera: true });
    setErrors({});
    let stream: MediaStream;
    try {
      stream = await access.request({
        audio: captureConstraints('microphone'),
        video: captureConstraints('camera'),
      });
    } catch {
      return devices.filter(isCurrent);
    } finally {
      devices.forEach((device) => {
        if (isCurrent(device)) setDevicePending(device, false);
      });
    }
    const missing: Device[] = [];
    for (const device of devices) {
      const tracks =
        device === 'microphone'
          ? stream.getAudioTracks()
          : stream.getVideoTracks();
      if (!isCurrent(device) || !enabled(device)) {
        tracks.forEach((track) => track.stop());
      } else if (tracks.length === 0) {
        missing.push(device);
      } else {
        accept(device, new MediaStream(tracks));
      }
    }
    return missing;
  }
  const toggle = (device: Device, value: boolean) => {
    setEnabled(device, value);
    if (value) void request(device);
    else stop(device);
  };
  const release = () => {
    preparation++;
    enumerationGeneration++;
    watchingDevices?.();
    watchingDevices = undefined;
    devices.forEach(stop);
  };
  onCleanup(() => {
    disposed = true;
    release();
  });
  return {
    microphoneEnabled,
    cameraEnabled,
    video,
    backgroundEffect,
    backgroundPending,
    backgroundError,
    setBackgroundEffect: (effect: BackgroundEffect) => {
      setBackground(effect);
      void updatePreview();
    },
    availableDevices,
    selectedDevices,
    deviceError,
    canSelectSpeaker: () => access?.canSelectSpeaker?.() ?? false,
    refreshDevices,
    selectDevice: (device: Device | 'speaker', deviceId: string) => {
      setSelectedDevices((current) => ({ ...current, [device]: deviceId }));
      if (device !== 'speaker' && enabled(device)) void request(device);
    },
    cameraError: () => errors().camera,
    microphoneError: () => errors().microphone,
    pending: () =>
      pending().microphone || pending().camera || backgroundPending(),
    errors: () =>
      Object.values(errors()).filter((message): message is string =>
        Boolean(message)
      ),
    prepare: async () => {
      const current = ++preparation;
      watchingDevices ??= access?.onDeviceChange?.(() => void refreshDevices());
      void refreshDevices();
      for (const device of await requestTogether(current)) {
        if (disposed || current !== preparation) return;
        await request(device);
      }
      if (!disposed && current === preparation) void refreshDevices();
    },
    setMicrophoneEnabled: (value: boolean) => toggle('microphone', value),
    setCameraEnabled: (value: boolean) => toggle('camera', value),
    /** Transfers live tracks of enabled devices; the caller must stop them. */
    handoff: (): MeetingLocalTracks | undefined => {
      const tracks: MeetingLocalTracks = {};
      for (const device of devices) {
        const track = streams[device]
          ?.getTracks()
          .find((candidate) => candidate.readyState === 'live');
        if (!enabled(device) || !track) continue;
        streams[device]?.removeTrack(track);
        tracks[device] = track;
      }
      release();
      return tracks.microphone || tracks.camera ? tracks : undefined;
    },
    release,
  };
}

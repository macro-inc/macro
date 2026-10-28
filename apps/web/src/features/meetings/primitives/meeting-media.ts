import {
  recordCallMediaFailure,
  traceCallMedia,
} from '@channel/Call/call-media-telemetry';
import type { BackgroundEffect } from '@core/media/background-effect';
import { fireAndForget } from '@core/util/fireAndForget';
import { type Span, Telemetry } from '@macro-inc/observability';
import { createSignal, onCleanup } from 'solid-js';
import type {
  MeetingLocalTracks,
  MeetingMediaDiagnostics,
} from '../context/meeting-session';

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
  const diagnostics: MeetingMediaDiagnostics = {
    setupId: crypto.randomUUID(),
    microphone: 'not_requested',
    camera: 'not_requested',
  };
  const captures: Partial<Record<Device, Span>> = {};
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
  // A second getUserMedia while the first permission prompt is open makes the
  // browser queue that prompt. Hold capture to one device at a time.
  let mediaAccess: Promise<void> = Promise.resolve();
  const enabled = (device: Device) =>
    device === 'microphone' ? microphoneEnabled() : cameraEnabled();
  const setEnabled = (device: Device, value: boolean) =>
    device === 'microphone' ? setMicrophone(value) : setCamera(value);
  const setDevicePending = (device: Device, value: boolean) =>
    setPending((current) => ({ ...current, [device]: value }));
  const stop = (device: Device) => {
    const capture = captures[device];
    if (capture) {
      capture.setAttr('call.media.outcome', 'cancelled');
      capture.end();
      delete captures[device];
      diagnostics[device] = 'cancelled';
    }
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
      const enumerate = access.enumerate;
      const devices = await traceCallMedia(
        'enumerate',
        {
          'meeting.setup.id': diagnostics.setupId,
        },
        enumerate
      );
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
      const processBackground = access.processBackground;
      const processed = await traceCallMedia(
        'background',
        {
          'meeting.setup.id': diagnostics.setupId,
          'call.media.device': 'camera',
          'call.media.background': effect.type,
        },
        () => processBackground(track, effect)
      );
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
      fireAndForget(refreshDevices(), 'meeting-media');
    });
    if (device === 'camera') fireAndForget(updatePreview(), 'meeting-media');
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
  async function runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const previous = mediaAccess;
    let release = () => {};
    mediaAccess = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      return await task();
    } finally {
      release();
    }
  }
  /** A camera that can't meet the preferred capture falls back to any mode. */
  async function capture(device: Device, isCurrent: () => boolean) {
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
      if (!isCurrent() || errorName(error) !== 'OverconstrainedError')
        throw error;
      captures[device]?.event('call.media.constraints_retry');
      const deviceId = selectedDevices().camera;
      return access.request({
        audio: false,
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
    }
  }
  function hasCurrentTrack(device: Device) {
    const track = streams[device]
      ?.getTracks()
      .find((candidate) => candidate.readyState === 'live');
    if (!track) return false;
    const selected = selectedDevices()[device];
    return !selected || track.getSettings?.().deviceId === selected;
  }
  async function acquire(device: Device, requireEnabled = false) {
    if (!access || disposed) return;
    if (requireEnabled && (!enabled(device) || hasCurrentTrack(device))) return;
    stop(device);
    const generation = generations[device];
    const isCurrent = () => !disposed && generations[device] === generation;
    setDevicePending(device, true);
    setErrors((current) => ({ ...current, [device]: undefined }));
    const span = Telemetry.span('call.media.capture');
    span.setAttr('meeting.setup.id', diagnostics.setupId);
    span.setAttr('call.media.device', device);
    span.setAttr('call.media.enabled', enabled(device));
    span.setAttr(
      'call.media.trigger',
      requireEnabled ? 'device_control' : 'prepare'
    );
    captures[device] = span;
    diagnostics[device] = 'pending';
    try {
      const stream = await span.run(() => capture(device, isCurrent));
      if (isCurrent()) {
        diagnostics[device] = 'granted';
        span.setAttr('call.media.outcome', 'granted');
        span.setAttr('call.media.retained', enabled(device));
      }
      if (!isCurrent() || !enabled(device)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      accept(device, stream);
      fireAndForget(refreshDevices(), 'meeting-media');
    } catch (error) {
      if (!isCurrent()) return;
      recordCallMediaFailure(span, error);
      const message = mediaErrorMessage(device, error);
      diagnostics[device] = message.permission ? 'blocked' : 'failed';
      // Permission is requested for both devices up front, but a hardware
      // problem only matters for a device the user actually turned on.
      if (!enabled(device) && !message.permission) return;
      setEnabled(device, false);
      setErrors((current) => ({ ...current, [device]: message.text }));
    } finally {
      if (captures[device] === span) {
        span.end();
        delete captures[device];
      }
      if (isCurrent()) setDevicePending(device, false);
    }
  }
  function request(device: Device) {
    return runExclusive(() => acquire(device, true));
  }
  const toggle = (device: Device, value: boolean) => {
    setEnabled(device, value);
    if (value) fireAndForget(request(device), 'meeting-media');
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
    diagnostics: (): MeetingMediaDiagnostics => ({ ...diagnostics }),
    microphoneEnabled,
    cameraEnabled,
    video,
    backgroundEffect,
    backgroundPending,
    backgroundError,
    setBackgroundEffect: (effect: BackgroundEffect) => {
      setBackground(effect);
      fireAndForget(updatePreview(), 'meeting-media');
    },
    availableDevices,
    selectedDevices,
    deviceError,
    canSelectSpeaker: () => access?.canSelectSpeaker?.() ?? false,
    refreshDevices,
    selectDevice: (device: Device | 'speaker', deviceId: string) => {
      setSelectedDevices((current) => ({ ...current, [device]: deviceId }));
      if (device !== 'speaker' && enabled(device))
        fireAndForget(request(device), 'meeting-media');
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
      watchingDevices ??= access?.onDeviceChange?.(() =>
        fireAndForget(refreshDevices(), 'meeting-media')
      );
      fireAndForget(refreshDevices(), 'meeting-media');
      setErrors({});
      await runExclusive(async () => {
        for (const device of devices) {
          if (disposed || current !== preparation) return;
          await acquire(device);
        }
      });
      if (!disposed && current === preparation)
        fireAndForget(refreshDevices(), 'meeting-media');
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

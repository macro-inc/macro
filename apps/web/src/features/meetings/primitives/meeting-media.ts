import { createSignal, onCleanup } from 'solid-js';

export type MeetingMediaAccess = {
  request: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
};

/** Local setup streams never connect to a room and are released before joining. */
export function createMeetingMedia(access?: MeetingMediaAccess) {
  type Device = 'microphone' | 'camera';
  const [microphoneEnabled, setMicrophone] = createSignal(true);
  const [cameraEnabled, setCamera] = createSignal(false);
  const [video, setVideo] = createSignal<MediaStream>();
  const [pending, setPending] = createSignal({
    microphone: false,
    camera: false,
  });
  const [errors, setErrors] = createSignal<Partial<Record<Device, string>>>({});
  const streams: Partial<Record<Device, MediaStream>> = {};
  const generations = { microphone: 0, camera: 0 };
  let disposed = false;
  let preparation = 0;
  const enabled = (device: Device) =>
    device === 'microphone' ? microphoneEnabled() : cameraEnabled();
  const setEnabled = (device: Device, value: boolean) =>
    device === 'microphone' ? setMicrophone(value) : setCamera(value);
  const stop = (device: Device) => {
    generations[device]++;
    streams[device]?.getTracks().forEach((track) => track.stop());
    delete streams[device];
    if (device === 'camera') setVideo(undefined);
    setPending((current) => ({ ...current, [device]: false }));
  };
  async function request(device: Device) {
    if (!access || disposed) return;
    stop(device);
    const generation = generations[device];
    setPending((current) => ({ ...current, [device]: true }));
    setErrors((current) => ({ ...current, [device]: undefined }));
    try {
      const stream = await access.request({
        audio: device === 'microphone',
        video: device === 'camera',
      });
      if (disposed || generations[device] !== generation || !enabled(device)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streams[device] = stream;
      if (device === 'camera') setVideo(stream);
    } catch (error) {
      if (disposed || generations[device] !== generation) return;
      setEnabled(device, false);
      const denied =
        error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      const label = device === 'microphone' ? 'Microphone' : 'Camera';
      setErrors((current) => ({
        ...current,
        [device]: denied
          ? `${label} access is blocked. Allow it in your browser settings, then turn it on to retry.`
          : `${label} is unavailable. Check the device, then turn it on to retry.`,
      }));
    } finally {
      if (!disposed && generations[device] === generation)
        setPending((current) => ({ ...current, [device]: false }));
    }
  }
  const toggle = (device: Device, value: boolean) => {
    setEnabled(device, value);
    if (value) void request(device);
    else stop(device);
  };
  const release = () => {
    preparation++;
    stop('microphone');
    stop('camera');
  };
  onCleanup(() => {
    disposed = true;
    release();
  });
  return {
    microphoneEnabled,
    cameraEnabled,
    video,
    pending: () => pending().microphone || pending().camera,
    errors: () =>
      Object.values(errors()).filter((message): message is string =>
        Boolean(message)
      ),
    prepare: async () => {
      const current = ++preparation;
      await request('microphone');
      if (!disposed && current === preparation) await request('camera');
    },
    setMicrophoneEnabled: (value: boolean) => toggle('microphone', value),
    setCameraEnabled: (value: boolean) => toggle('camera', value),
    release,
  };
}

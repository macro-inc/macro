import { fireAndForget } from '@core/util/fireAndForget';
import { createSignal, onCleanup } from 'solid-js';

export type CallMediaDevice = 'microphone' | 'camera';

/** Permission state belongs to the call owner, not its transient controls. */
export function createCallMediaPermissions() {
  const [microphone, setMicrophone] = createSignal<PermissionState>('prompt');
  const [camera, setCamera] = createSignal<PermissionState>('prompt');
  const revisions = { microphone: 0, camera: 0 };
  const cleanups: (() => void)[] = [];
  let disposed = false;
  const set = (device: CallMediaDevice, state: PermissionState) => {
    if (disposed) return;
    revisions[device] += 1;
    if (device === 'microphone') setMicrophone(state);
    else setCamera(state);
  };

  async function watch(device: CallMediaDevice) {
    if (!navigator.permissions?.query) return;
    const revision = revisions[device];
    try {
      const status = await navigator.permissions.query({
        name: device as PermissionName,
      });
      if (disposed) return;
      if (revisions[device] === revision) set(device, status.state);
      const change = () => set(device, status.state);
      status.addEventListener('change', change);
      cleanups.push(() => status.removeEventListener('change', change));
    } catch {
      // Safari/webviews can omit media permissions. Capture outcomes still work.
    }
  }

  async function capture<T>(
    device: CallMediaDevice,
    action: () => Promise<T>,
    current: () => boolean = () => true
  ): Promise<T> {
    const revision = ++revisions[device];
    try {
      const result = await action();
      if (current() && revisions[device] === revision) set(device, 'granted');
      return result;
    } catch (error) {
      if (
        current() &&
        revisions[device] === revision &&
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'NotAllowedError'
      )
        set(device, 'denied');
      throw error;
    }
  }

  onCleanup(() => {
    disposed = true;
    cleanups.forEach((cleanup) => cleanup());
  });
  // watch catches unsupported queries and installs listeners only while owned.
  fireAndForget(watch('microphone'), 'call-media-permission');
  fireAndForget(watch('camera'), 'call-media-permission');
  return { microphone, camera, capture };
}

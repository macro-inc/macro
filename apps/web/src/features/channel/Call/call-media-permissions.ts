import { fireAndForget } from '@core/util/fireAndForget';
import { createSignal, onCleanup } from 'solid-js';

export type CallMediaDevice = 'microphone' | 'camera';

/** Permission state and pending recovery belong to the call owner. */
export function createCallMediaPermissions(options?: {
  onGranted: (device: CallMediaDevice) => Promise<void>;
}) {
  const [microphone, setMicrophone] = createSignal<PermissionState>('prompt');
  const [camera, setCamera] = createSignal<PermissionState>('prompt');
  const revisions = { microphone: 0, camera: 0 };
  const recovery: Partial<Record<CallMediaDevice, () => boolean>> = {};
  const recovering = new Set<CallMediaDevice>();
  const cleanups: (() => void)[] = [];
  let disposed = false;
  const set = (device: CallMediaDevice, state: PermissionState) => {
    if (disposed) return;
    revisions[device] += 1;
    if (device === 'microphone') setMicrophone(state);
    else setCamera(state);
  };
  const recover = (device: CallMediaDevice) => {
    if (disposed || !recovery[device] || recovering.has(device)) return;
    if (!recovery[device]() || !options) {
      delete recovery[device];
      return;
    }
    recovering.add(device);
    fireAndForget(
      (async () => {
        try {
          await options.onGranted(device);
        } finally {
          recovering.delete(device);
        }
      })(),
      'call-media-permission'
    );
  };
  const update = (device: CallMediaDevice, state: PermissionState) => {
    // Keep denial visible until recovery actually captures the device; OS privacy
    // can still block capture while the browser permission reports granted.
    if (state === 'granted' && recovery[device]?.() && options) {
      recover(device);
      return;
    }
    set(device, state);
    if (state === 'granted') recover(device);
  };

  async function watch(device: CallMediaDevice, subscribe = true) {
    if (!navigator.permissions?.query) {
      if (!subscribe) recover(device);
      return;
    }
    const revision = revisions[device];
    try {
      const status = await navigator.permissions.query({
        name: device as PermissionName,
      });
      if (disposed) return;
      if (revisions[device] === revision) update(device, status.state);
      if (!subscribe) return;
      const change = () => update(device, status.state);
      status.addEventListener('change', change);
      cleanups.push(() => status.removeEventListener('change', change));
    } catch {
      // Capture remains authoritative when media permission queries are unsupported.
      if (!subscribe) recover(device);
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
      if (current() && revisions[device] === revision) {
        delete recovery[device];
        set(device, 'granted');
      }
      return result;
    } catch (error) {
      if (
        !disposed &&
        current() &&
        revisions[device] === revision &&
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'NotAllowedError'
      ) {
        recovery[device] = current;
        let state: PermissionState = 'denied';
        try {
          const status = await navigator.permissions?.query({
            name: device as PermissionName,
          });
          // A dismissed prompt is retryable. OS denial can coexist with a granted browser permission.
          if (status?.state === 'prompt') state = 'prompt';
        } catch {
          /* Unsupported queries retain the capture denial. */
        }
        if (!disposed && current() && revisions[device] === revision)
          set(device, state);
      }
      throw error;
    }
  }

  const refresh = () => {
    fireAndForget(watch('microphone', false), 'call-media-permission');
    fireAndForget(watch('camera', false), 'call-media-permission');
  };
  window.addEventListener('focus', refresh);
  onCleanup(() => {
    disposed = true;
    window.removeEventListener('focus', refresh);
    cleanups.forEach((cleanup) => cleanup());
  });
  fireAndForget(watch('microphone'), 'call-media-permission');
  fireAndForget(watch('camera'), 'call-media-permission');
  return { microphone, camera, capture };
}

import { fireAndForget } from '@core/util/fireAndForget';
import { onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';

export type CallMediaDevice = 'microphone' | 'camera';

export function isPermissionDenial(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  return 'name' in error && error.name === 'NotAllowedError';
}

/** Permission state and pending recovery belong to the call owner. */
export function createCallMediaPermissions(options?: {
  onGranted: (device: CallMediaDevice) => Promise<void>;
}) {
  const [permissions, setPermission] = createStore<
    Record<CallMediaDevice, PermissionState>
  >({
    microphone: 'prompt',
    camera: 'prompt',
  });
  const revisions = { microphone: 0, camera: 0 };
  const cancellations = { microphone: 0, camera: 0 };
  const attempts = { microphone: 0, camera: 0 };
  const recovery: Partial<Record<CallMediaDevice, () => boolean>> = {};
  const recovering = new Set<CallMediaDevice>();
  const cleanups: (() => void)[] = [];
  let disposed = false;
  const set = (device: CallMediaDevice, state: PermissionState) => {
    if (disposed) return;
    revisions[device] += 1;
    setPermission(device, state);
  };
  // Retire the request as well as its saved denial so a later grant cannot
  // enable a device after Cancel, key release, or a different user action.
  const cancelRecovery = (device: CallMediaDevice) => {
    revisions[device] += 1;
    cancellations[device] += 1;
    delete recovery[device];
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
    current: () => boolean = () => true,
    onCancelled?: () => Promise<void>
  ): Promise<T> {
    const revision = ++revisions[device];
    const cancellation = cancellations[device];
    const attempt = ++attempts[device];
    try {
      const result = await action();
      // A browser prompt cannot be withdrawn. If Cancel wins while capture is
      // pending, disable its result before returning; a newer explicit capture wins.
      const cancelled = cancellation !== cancellations[device];
      if (cancelled) {
        if (current() && attempts[device] === attempt) await onCancelled?.();
        return result;
      }
      if (current() && revisions[device] === revision) {
        delete recovery[device];
        set(device, 'granted');
      }
      return result;
    } catch (error) {
      const currentRequest =
        !disposed && current() && revisions[device] === revision;
      const denied = isPermissionDenial(error);
      if (currentRequest && denied) {
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
  return {
    microphone: () => permissions.microphone,
    camera: () => permissions.camera,
    capture,
    cancelRecovery,
  };
}

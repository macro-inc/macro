import { createMemo, onCleanup } from 'solid-js';
import { createStore, produce, unwrap } from 'solid-js/store';
import {
  type CallMediaDevice,
  isPermissionDenial,
} from './call-media-permissions';

type Media = {
  microphonePermission?: () => PermissionState;
  cameraPermission?: () => PermissionState;
  toggleAudio: (enabled?: boolean) => Promise<void>;
  toggleVideo: (enabled?: boolean) => Promise<void>;
  cancelMediaPermissionRecovery?: (device: CallMediaDevice) => void;
};

type PermissionHelpState = {
  help?: { device: CallMediaDevice; anchor?: HTMLElement };
  pending: Record<CallMediaDevice, boolean>;
};
export function createCallMediaPermissionHelp(media: Media) {
  const [state, setState] = createStore<PermissionHelpState>({
    pending: { microphone: false, camera: false },
  });
  const setHelp = (value: typeof state.help) =>
    setState(
      produce((state) => {
        state.help = value;
      })
    );
  let revision = 0;
  let returnFocus: HTMLElement | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    revision++;
  });
  const permission = (device: CallMediaDevice) =>
    device === 'microphone'
      ? media.microphonePermission?.()
      : media.cameraPermission?.();
  const retiredHelp = createMemo<typeof state.help>((previous) => {
    const current = unwrap(state.help);
    return current && permission(current.device) === 'granted'
      ? current
      : previous;
  });
  const help = () => {
    const current = unwrap(state.help);
    return current === retiredHelp() ? undefined : current;
  };
  const close = () => {
    const current = help();
    if (current) media.cancelMediaPermissionRecovery?.(current.device);
    revision++;
    setHelp(undefined);
  };
  const request = async (
    device: CallMediaDevice,
    retry = false,
    trigger?: HTMLElement
  ) => {
    if (state.pending[device] || disposed) return;
    const current = ++revision;
    const previous = help();
    const findAnchor = () => {
      if (trigger) return trigger;
      if (retry && previous?.device === device) return previous.anchor;
      if (document.activeElement instanceof HTMLElement)
        return document.activeElement;
      return undefined;
    };
    const anchor = findAnchor();
    returnFocus = anchor;
    const blocked = permission(device) === 'denied';
    if (blocked) setHelp({ device, anchor });
    setState('pending', device, true);
    try {
      const enable = retry || blocked ? true : undefined;
      if (device === 'microphone') await media.toggleAudio(enable);
      else await media.toggleVideo(enable);
      if (!disposed && current === revision) setHelp(undefined);
    } catch (error) {
      if (permission(device) !== 'denied' && !isPermissionDenial(error))
        throw error;
      if (!disposed && current === revision) setHelp({ device, anchor });
    } finally {
      if (!disposed) setState('pending', device, false);
    }
  };
  return {
    help,
    pending: () => {
      const current = help();
      return !!current && state.pending[current.device];
    },
    request,
    close,
    restoreFocus: () => {
      if (
        !help() &&
        returnFocus?.isConnected &&
        !returnFocus.matches(':disabled')
      ) {
        returnFocus.focus({ preventScroll: true });
      }
    },
  };
}

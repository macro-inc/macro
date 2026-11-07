import { fireAndForget } from '@core/util/fireAndForget';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import type {
  ConnectScreen,
  ScreenConnection,
  ScreenHost,
} from '../context/screen-context';

export function createScreenConnection(
  host: ScreenHost,
  target: Accessor<HTMLElement | undefined>,
  connect: ConnectScreen
) {
  const sessionId = createMemo(host.sessionId);
  const harnessId = createMemo(host.harnessId);
  const [requestedControl, setRequestedControl] = createSignal(false);
  const [retry, setRetry] = createSignal(0);
  const [status, setStatus] = createSignal<
    'connecting' | 'connected' | 'error'
  >('connecting');
  const canControl = () => host.canEdit() && !host.touch();
  const controlling = createMemo(() => requestedControl() && canControl());
  // Losing permission or changing the computer always resets the request.
  createEffect(
    on(
      () => [sessionId(), harnessId(), host.startControlling?.()],
      () =>
        setRequestedControl(host.startControlling?.() === true && canControl())
    )
  );
  createEffect(() => {
    if (!canControl()) setRequestedControl(false);
  });
  createEffect(() => {
    sessionId();
    const element = target();
    const id = harnessId();
    const control = controlling();
    retry();
    if (!element || !id) return;
    let disposed = false;
    let connection: ScreenConnection | undefined;
    setStatus('connecting');
    const open = async () => {
      try {
        const url = await host.resolveUrl(id, control);
        if (disposed) return;
        const next = await connect(element, url, control, {
          connected: () => {
            if (!disposed) setStatus('connected');
          },
          disconnected: () => {
            if (!disposed) setStatus('error');
          },
        });
        if (disposed) next.disconnect();
        else connection = next;
      } catch {
        if (!disposed) setStatus('error');
      }
    };
    fireAndForget(open(), 'computer-screen');
    onCleanup(() => {
      disposed = true;
      connection?.disconnect();
    });
  });
  return {
    status,
    canControl,
    controlling,
    toggleControl: () =>
      setRequestedControl((current) => canControl() && !current),
    retry: () => setRetry((current) => current + 1),
  };
}

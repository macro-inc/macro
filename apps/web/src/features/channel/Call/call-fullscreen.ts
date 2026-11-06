import { Telemetry } from '@macro-inc/observability';
import { type Accessor, createSignal, onCleanup } from 'solid-js';

export function createCallFullscreen(root: Accessor<HTMLElement | undefined>) {
  const [active, setActive] = createSignal(false);
  let pending = false;
  let disposed = false;
  let ownedElement: HTMLElement | undefined;
  const sync = () =>
    setActive(!!root() && document.fullscreenElement === root());
  document.addEventListener('fullscreenchange', sync);
  const available = () =>
    document.fullscreenEnabled !== false &&
    typeof root()?.requestFullscreen === 'function';
  const toggle = async () => {
    const element = root();
    if (!element || !available() || pending) return;
    pending = true;
    ownedElement = element;
    try {
      await Telemetry.span('call.fullscreen.toggle', async () => {
        if (document.fullscreenElement === element)
          await document.exitFullscreen();
        else await element.requestFullscreen();
      });
      if (disposed && document.fullscreenElement === element)
        await document.exitFullscreen();
      if (!disposed) sync();
    } finally {
      pending = false;
    }
  };
  onCleanup(() => {
    disposed = true;
    document.removeEventListener('fullscreenchange', sync);
    const element = ownedElement ?? root();
    if (element && document.fullscreenElement === element)
      void document.exitFullscreen().catch(() => {});
  });
  return { active, available, toggle };
}

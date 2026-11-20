import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { type Accessor, createSignal, onCleanup } from 'solid-js';

export function createCallFullscreen(root: Accessor<HTMLElement | undefined>) {
  const [active, setActive] = createSignal(false);
  let pending = false;
  let disposed = false;
  let ownedElement: HTMLElement | undefined;
  let generation = 0;
  const sync = () =>
    setActive(!!root() && document.fullscreenElement === root());
  document.addEventListener('fullscreenchange', sync);
  const available = () =>
    document.fullscreenEnabled !== false &&
    typeof root()?.requestFullscreen === 'function';
  const enter = async () => {
    const element = root();
    if (!element || !available()) return;
    if (pending || document.fullscreenElement === element) return;
    const request = ++generation;
    pending = true;
    ownedElement = element;
    try {
      await Telemetry.span('call.fullscreen.toggle', async () => {
        await element.requestFullscreen();
      });
      if (
        (disposed || request !== generation) &&
        document.fullscreenElement === element
      )
        await document.exitFullscreen();
      if (!disposed) sync();
    } finally {
      pending = false;
    }
  };
  const exit = async () => {
    generation++;
    if (document.fullscreenElement === (ownedElement ?? root()))
      await document.exitFullscreen();
    if (!disposed) sync();
  };
  const toggle = () => (active() ? exit() : enter());
  onCleanup(() => {
    disposed = true;
    document.removeEventListener('fullscreenchange', sync);
    const element = ownedElement ?? root();
    if (!element || document.fullscreenElement !== element) return;
    const release = async () => {
      try {
        await document.exitFullscreen();
      } catch {
        // The browser can exit first while the owning surface unmounts.
      }
    };
    fireAndForget(release(), 'call-fullscreen');
  });
  return { active, available, toggle, enter, exit };
}

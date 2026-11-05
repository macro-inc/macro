import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

const CONTROLS_IDLE_MS = 4000;

/** Keep controls mounted; only their presentation changes when the call is idle. */
export function createControlsVisibility(options: {
  enabled: Accessor<boolean>;
  keepVisible: Accessor<boolean>;
}) {
  const [visible, setVisible] = createSignal(true);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function reveal() {
    clearTimeout(timer);
    setVisible(true);
    if (!options.enabled() || options.keepVisible()) return;
    timer = setTimeout(() => setVisible(false), CONTROLS_IDLE_MS);
  }

  createEffect(reveal);
  onCleanup(() => clearTimeout(timer));

  return { visible, reveal };
}

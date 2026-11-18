import { fireAndForget } from '@core/util/fireAndForget';
import { makeEventListener } from '@solid-primitives/event-listener';

/** Unlock even when muted: the gesture itself can turn sounds on. */
export function createSoundUnlock(unlock: () => Promise<void>) {
  const activate = (event: Event) => {
    if (event.isTrusted) fireAndForget(unlock(), 'audio-unlock');
  };
  const options = { capture: true, passive: true };
  makeEventListener(window, 'pointerdown', activate, options);
  // Assistive technology can dispatch a trusted click without pointer events.
  makeEventListener(window, 'click', activate, options);
  makeEventListener(
    window,
    'keydown',
    (event) => {
      if (event.key === 'Enter' || event.key === ' ') activate(event);
    },
    options
  );
}

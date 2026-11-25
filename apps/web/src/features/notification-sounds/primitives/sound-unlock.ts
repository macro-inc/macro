import { fireAndForget } from '@core/util/fireAndForget';
import { makeEventListener } from '@solid-primitives/event-listener';
import { type Accessor, createEffect, createSignal, on } from 'solid-js';
import type { SoundPlayer } from './sound-player';

const isPageVisible = () => document.visibilityState !== 'hidden';

/**
 * Unlocks the player on a trusted gesture, but only while its sounds are
 * wanted, and keeps its context running only while they are wanted and the
 * page is visible. A hidden page suspends the context once the last cue ends;
 * the next cue or gesture resumes it.
 */
export function createSoundUnlock(
  player: Pick<SoundPlayer, 'unlock' | 'setKeepRunning'>,
  wanted: Accessor<boolean>
) {
  const [visible, setVisible] = createSignal(isPageVisible());
  const syncVisible = () => setVisible(isPageVisible());
  makeEventListener(document, 'visibilitychange', syncVisible);
  // pagehide covers a page entering the back/forward cache or unloading.
  makeEventListener(window, 'pagehide', () => setVisible(false));
  makeEventListener(window, 'pageshow', syncVisible);

  createEffect(() => player.setKeepRunning(wanted() && visible()));

  const unlock = () => fireAndForget(player.unlock(), 'audio-unlock');

  // Sounds turned on (or a call started) inside a tap unlock within it, since
  // the gesture listeners below already ran while sounds were still off.
  createEffect(
    on(wanted, (now, before) => {
      if (now && !before && navigator.userActivation?.isActive) unlock();
    })
  );

  const activate = (event: Event) => {
    if (event.isTrusted && wanted()) unlock();
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

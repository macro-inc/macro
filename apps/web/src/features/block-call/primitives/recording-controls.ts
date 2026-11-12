import { debounce } from '@core/util/debounce';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';

type ControlsState = {
  idle: boolean;
  hovered: boolean;
  focused: boolean;
  menuOpen: boolean;
};

/** Keep controls reachable during interactions, without obscuring idle playback. */
export function createRecordingControlsVisibility(paused: Accessor<boolean>) {
  const [state, setState] = createStore<ControlsState>({
    idle: false,
    hovered: false,
    focused: false,
    menuOpen: false,
  });
  // Hover, focus and open menus hold controls visible even after the idle timer expires.
  const held = () => state.hovered || state.focused || state.menuOpen;
  const dismiss = debounce(() => setState('idle', true), 2500);
  const show = () => {
    setState('idle', false);
    dismiss.clear();
    if (!paused() && !held()) dismiss();
  };

  // Reset the timer when playback or interaction changes, not on every time update.
  createEffect(on([paused, held], show));
  onCleanup(() => dismiss.clear());

  return {
    visible: () => paused() || held() || !state.idle,
    show,
    setHovered: (value: boolean) => setState('hovered', value),
    setFocused: (value: boolean) => setState('focused', value),
    setMenuOpen: (value: boolean) => setState('menuOpen', value),
  };
}

export type RecordingControlsVisibility = ReturnType<
  typeof createRecordingControlsVisibility
>;

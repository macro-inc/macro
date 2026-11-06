import { debounce } from '@core/util/debounce';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';

/** Keep controls reachable during interactions, without obscuring idle playback. */
export function createRecordingControlsVisibility(paused: Accessor<boolean>) {
  const [idle, setIdle] = createSignal(false);
  const [hovered, setHovered] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const held = () => hovered() || focused() || menuOpen();
  const dismiss = debounce(() => setIdle(true), 2500);
  const show = () => {
    setIdle(false);
    dismiss.clear();
    if (!paused() && !held()) dismiss();
  };

  // Playback and interaction changes restart the external idle timer.
  createEffect(on([paused, held], show));
  onCleanup(() => dismiss.clear());

  return {
    visible: () => paused() || held() || !idle(),
    show,
    setHovered,
    setFocused,
    setMenuOpen,
  };
}

export type RecordingControlsVisibility = ReturnType<
  typeof createRecordingControlsVisibility
>;

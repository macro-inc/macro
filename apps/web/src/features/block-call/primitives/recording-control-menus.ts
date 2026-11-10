import { type Accessor, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { RecordingControlsVisibility } from './recording-controls';

type RecordingMenuState = {
  speedOpen: boolean;
  volumeOpen: boolean;
  mount: HTMLElement | undefined;
};

export function createRecordingControlMenus(
  visibility: Accessor<RecordingControlsVisibility>
) {
  const [state, setState] = createStore<RecordingMenuState>({
    speedOpen: false,
    volumeOpen: false,
    mount: undefined,
  });
  let controls: HTMLDivElement | undefined;
  let fullscreenButton: HTMLButtonElement | undefined;
  const setOpen = (menu: 'speedOpen' | 'volumeOpen', open: boolean) => {
    setState(menu, open);
    visibility().setMenuOpen(state.speedOpen || state.volumeOpen);
  };
  onCleanup(() => visibility().setMenuOpen(false));
  onMount(() => {
    const updateMount = () => {
      const fullscreen = document.fullscreenElement;
      setState(
        'mount',
        fullscreen instanceof HTMLElement &&
          controls &&
          fullscreen.contains(controls)
          ? fullscreen
          : undefined
      );
    };
    updateMount();
    document.addEventListener('fullscreenchange', updateMount);
    onCleanup(() =>
      document.removeEventListener('fullscreenchange', updateMount)
    );
  });
  return {
    mount: () => state.mount,
    volumeOpen: () => state.volumeOpen,
    setSpeedOpen: (open: boolean) => setOpen('speedOpen', open),
    setVolumeOpen: (open: boolean) => setOpen('volumeOpen', open),
    setControlsRef: (element: HTMLDivElement) => {
      controls = element;
    },
    setFullscreenRef: (element: HTMLButtonElement) => {
      fullscreenButton = element;
    },
    focusFullscreen: () => fullscreenButton?.focus(),
  };
}

import { createSignal, onCleanup, onMount } from 'solid-js';

const [isAltKeyPressed, setIsAltKeyPressed] = createSignal(false);

export function mountGlobalAltKeyListener() {
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && !isAltKeyPressed()) {
        setIsAltKeyPressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.altKey && isAltKeyPressed()) {
        setIsAltKeyPressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    });
  });
}

export const altKeyPressed = isAltKeyPressed;
export const resetAltKeyPressed = () => setIsAltKeyPressed(false);

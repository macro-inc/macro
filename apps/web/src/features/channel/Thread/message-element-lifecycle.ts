import { onCleanup, onMount } from 'solid-js';

/** Called once connected; the returned cleanup runs when the row is disposed. */
export type MessageElementMount = (
  id: string,
  element: HTMLElement
) => (() => void) | void;

/** Attach from a row's ref, which can run before the element is connected. */
export function notifyElementOnMount(
  onElementMount: MessageElementMount | undefined,
  id: string,
  element: HTMLElement
) {
  if (!onElementMount) return;
  let cleanup: (() => void) | void;
  onMount(() => {
    cleanup = onElementMount(id, element);
  });
  onCleanup(() => cleanup?.());
}

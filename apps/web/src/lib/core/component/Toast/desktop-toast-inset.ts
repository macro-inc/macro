import { onCleanup } from 'solid-js';

const PROPERTY = '--desktop-toast-inset-bottom';

/**
 * Elements that sit above the desktop toast stack, and the inset the stack
 * last published (undefined while no stack is mounted). The stack writes the
 * property on these elements alone: on `<html>` every element inherits it, so
 * each frame of a toast's animation restyled the whole page.
 */
const followers = new Set<HTMLElement>();
let published: string | undefined;

function write(element: HTMLElement, value: string | undefined) {
  if (value === undefined) element.style.removeProperty(PROPERTY);
  else element.style.setProperty(PROPERTY, value);
}

/**
 * A `ref` for an element in a view's bottom-right corner: it gets
 * `--desktop-toast-inset-bottom`, how far the desktop toast stack reaches up
 * from the window's bottom edge (0 while the stack shows nothing), to add to
 * its own offset. Call it while rendering, where `onCleanup` has an owner.
 */
export function followDesktopToastInset(element: HTMLElement) {
  followers.add(element);
  write(element, published);
  onCleanup(() => followers.delete(element));
}

/** The desktop stack's side: undefined clears the inset. */
export function publishDesktopToastInset(value: string | undefined) {
  if (value === published) return;
  published = value;
  for (const element of followers) write(element, value);
}

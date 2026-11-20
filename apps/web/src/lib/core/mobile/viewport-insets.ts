import { createContext, onCleanup, useContext } from 'solid-js';

/**
 * Mobile viewport values (the bottom chrome's height, the keyboard) that CSS
 * reads as custom properties. Each one is written only on the elements that
 * read it, which register with a `follow*` ref: a custom property on `<html>`
 * is inherited by every element, so each keyboard show, keyboard hide and
 * composer line restyled the whole page (15-90 ms in WebKit).
 */

type Apply = (element: HTMLElement, value: string | undefined) => void;

function createPublishedValue() {
  const followers = new Map<HTMLElement, Apply>();
  let current: string | undefined;
  return {
    publish(next: string | undefined) {
      if (next === current) return;
      current = next;
      for (const [element, apply] of followers) apply(element, next);
    },
    /** Call while rendering (a `ref`), where `onCleanup` has an owner. */
    follow(element: HTMLElement, apply: Apply) {
      followers.set(element, apply);
      apply(element, current);
      onCleanup(() => {
        if (followers.get(element) !== apply) return;
        followers.delete(element);
        apply(element, undefined);
      });
    },
  };
}

const writeProperty =
  (name: string): Apply =>
  (element, value) => {
    if (value === undefined) element.style.removeProperty(name);
    else element.style.setProperty(name, value);
  };

const contentInsetBottom = createPublishedValue();
const viewportUnit = createPublishedValue();
const keyboardHeight = createPublishedValue();

const NoContentInsetBottom = createContext(false);

/**
 * Content under it has no bottom chrome to clear (a sheet over the page):
 * its `followContentInsetBottom` elements leave the property unset, so
 * their `var()` fallback (0) applies.
 */
export const NoContentInsetBottomProvider = NoContentInsetBottom.Provider;

/**
 * Publishes the bottom chrome's height (the float region host) in px, or
 * `undefined` while no host is mounted.
 */
export function publishContentInsetBottom(px: number | undefined) {
  contentInsetBottom.publish(px === undefined ? undefined : `${px}px`);
}

const writeContentInsetBottom = writeProperty('--mobile-content-inset-bottom');

/**
 * A `ref` for an element whose own styles read
 * `--mobile-content-inset-bottom`, the bottom chrome's height to clear. The
 * property is registered non-inheriting (index.css), so it reaches this
 * element alone, and is unset (its `var()` fallback applies) elsewhere: a
 * child that reads it registers itself.
 */
export function followContentInsetBottom(element: HTMLElement) {
  if (useContext(NoContentInsetBottom)) return;
  contentInsetBottom.follow(element, writeContentInsetBottom);
}

/**
 * Publishes the keyboard: the height left above it as a `--dvh` unit (a
 * hundredth of it, `1dvh` without a keyboard) and the keyboard's own height
 * in px. `undefined` clears both (the fallbacks then apply).
 */
export function publishKeyboardViewport(
  viewport: { dvh: string; keyboardHeight: number } | undefined
) {
  viewportUnit.publish(viewport?.dvh);
  keyboardHeight.publish(
    viewport === undefined ? undefined : `${viewport.keyboardHeight}px`
  );
}

const writeViewportUnit = writeProperty('--dvh');
const writeKeyboardHeight = writeProperty('--virtual-keyboard-height');

/**
 * A `ref` for an element whose styles, or its descendants' styles, read
 * `--dvh` or `--virtual-keyboard-height` (composers' max height, sheets and
 * dialogs above the keyboard). Both inherit, so keep it to small subtrees;
 * the app frame uses `followViewportHeight`.
 */
export function followKeyboardViewport(element: HTMLElement) {
  viewportUnit.follow(element, writeViewportUnit);
  keyboardHeight.follow(element, writeKeyboardHeight);
}

/**
 * A `ref` for the app frame: its height is the viewport left above the
 * keyboard (`100 * --dvh`), set directly so it restyles the frame alone
 * rather than everything inside it.
 */
export function followViewportHeight(element: HTMLElement) {
  viewportUnit.follow(element, (target, unit) => {
    if (unit === undefined) target.style.removeProperty('height');
    else target.style.setProperty('height', `calc(${unit} * 100)`);
  });
}

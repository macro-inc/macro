import {
  type Accessor,
  createContext,
  createRenderEffect,
  createSignal,
  onCleanup,
  useContext,
} from 'solid-js';
import { createStore } from 'solid-js/store';

/**
 * Mobile viewport values (the bottom chrome's height, the keyboard) that CSS
 * reads as custom properties. Each one is written only on the elements that
 * read it, which register with a `follow*` ref: a custom property on `<html>`
 * is inherited by every element, so each keyboard show, keyboard hide and
 * composer line restyled the whole page (15-90 ms in WebKit).
 */

const [contentInsetBottom, setContentInsetBottom] = createSignal<string>();
// Published together; each follower tracks only the field it writes.
const [keyboard, setKeyboard] = createStore<{
  viewportUnit?: string;
  height?: string;
}>({});

/**
 * Keeps `property` in the element's inline style equal to `value`, removed
 * while it is undefined and when the caller's owner is disposed. Call while
 * rendering (a `ref`). A render effect, unlike `createEffect`, also runs
 * while a Suspense boundary holds the element's content back.
 */
function follow(
  element: HTMLElement,
  property: string,
  value: Accessor<string | undefined>
) {
  createRenderEffect(() => {
    const next = value();
    if (next === undefined) element.style.removeProperty(property);
    else element.style.setProperty(property, next);
  });
  onCleanup(() => element.style.removeProperty(property));
}

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
  setContentInsetBottom(px === undefined ? undefined : `${px}px`);
}

/**
 * A `ref` for an element whose own styles read
 * `--mobile-content-inset-bottom`, the bottom chrome's height to clear. The
 * property is registered non-inheriting (index.css), so it reaches this
 * element alone, and is unset (its `var()` fallback applies) elsewhere: a
 * child that reads it registers itself. Resetting the element's whole `style`
 * attribute drops the value until the next publish.
 */
export function followContentInsetBottom(element: HTMLElement) {
  if (useContext(NoContentInsetBottom)) return;
  follow(element, '--mobile-content-inset-bottom', contentInsetBottom);
}

/**
 * Publishes the keyboard: the height left above it as a `--dvh` unit (a
 * hundredth of it, `1dvh` without a keyboard) and the keyboard's own height
 * in px. `undefined` clears both (the fallbacks then apply).
 */
export function publishKeyboardViewport(
  viewport: { dvh: string; keyboardHeight: number } | undefined
) {
  setKeyboard({
    viewportUnit: viewport?.dvh,
    height: viewport === undefined ? undefined : `${viewport.keyboardHeight}px`,
  });
}

/**
 * A `ref` for an element whose styles, or its descendants' styles, read
 * `--dvh` or `--virtual-keyboard-height` (composers' max height, sheets and
 * dialogs above the keyboard). Both inherit, so keep it to small subtrees;
 * the app frame uses `followViewportHeight`.
 */
export function followKeyboardViewport(element: HTMLElement) {
  follow(element, '--dvh', () => keyboard.viewportUnit);
  follow(element, '--virtual-keyboard-height', () => keyboard.height);
}

/**
 * A `ref` for the app frame: its height is the viewport left above the
 * keyboard (`100 * --dvh`), set directly so it restyles the frame alone
 * rather than everything inside it.
 */
export function followViewportHeight(element: HTMLElement) {
  follow(element, 'height', () => {
    const unit = keyboard.viewportUnit;
    return unit === undefined ? undefined : `calc(${unit} * 100)`;
  });
}

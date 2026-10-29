import { callHandler } from '@kobalte/utils';
import type { JSX } from 'solid-js';

type ClickEvent = Parameters<
  JSX.EventHandler<HTMLButtonElement, MouseEvent>
>[0];
type AuxClickEvent = Parameters<
  JSX.EventHandler<HTMLButtonElement, PointerEvent>
>[0];
type KeyEvent = Parameters<
  JSX.EventHandler<HTMLButtonElement, KeyboardEvent>
>[0];
type Handlers = Pick<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  'onClick' | 'onAuxClick' | 'onKeyDown' | 'onKeyUp'
>;

function hasNativeActivation(element: HTMLElement): boolean {
  if (element.tagName === 'BUTTON') return true;
  if (element.tagName === 'A') return element.hasAttribute('href');
  if (element.tagName !== 'INPUT') return false;
  return ['button', 'submit', 'reset', 'image', 'file', 'color'].includes(
    (element as HTMLInputElement).type
  );
}

/** Kobalte supplies disabled semantics; non-native actions still need activation guards. */
export function createButtonActivation(
  unavailable: () => boolean,
  handlers: Handlers
) {
  function blockUnavailable(event: Event): boolean {
    if (!unavailable()) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function handleKey(
    event: KeyEvent,
    handler: Handlers['onKeyDown'],
    activateOn: 'Enter' | ' '
  ) {
    const activationKey = event.key === 'Enter' || event.key === ' ';
    if (activationKey && blockUnavailable(event)) return;
    callHandler(event, handler);
    if (
      !activationKey ||
      event.defaultPrevented ||
      event.target !== event.currentTarget
    )
      return;
    if (hasNativeActivation(event.currentTarget)) return;

    // Non-native actions press on Enter and release on Space, like native buttons.
    if (event.key === ' ') event.preventDefault();
    if (event.key !== activateOn) return;
    event.preventDefault();
    event.currentTarget.click();
  }

  return {
    onClick: (event: ClickEvent) => {
      if (blockUnavailable(event)) return;
      callHandler(event, handlers.onClick);
    },
    onAuxClick: (event: AuxClickEvent) => {
      if (blockUnavailable(event)) return;
      callHandler(event, handlers.onAuxClick);
    },
    onKeyDown: (event: KeyEvent) =>
      handleKey(event, handlers.onKeyDown, 'Enter'),
    onKeyUp: (event: KeyEvent) => handleKey(event, handlers.onKeyUp, ' '),
  };
}

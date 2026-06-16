import { isMac } from '@solid-primitives/platform';
import { type Accessor, onCleanup } from 'solid-js';

export type CtrlJKMenuNavigationOptions = {
  enabled?: boolean;
  macOnly?: boolean;
};

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      ctrlJKMenuNavigation: CtrlJKMenuNavigationOptions | boolean | undefined;
    }
  }
}

function resolveOptions(
  options: CtrlJKMenuNavigationOptions | boolean | undefined
): Required<CtrlJKMenuNavigationOptions> {
  if (typeof options === 'boolean') {
    return { enabled: options, macOnly: true };
  }

  return {
    enabled: options?.enabled ?? true,
    macOnly: options?.macOnly ?? true,
  };
}

function translatedArrowKey(e: KeyboardEvent, macOnly: boolean) {
  if (macOnly && !isMac) return;
  if (!e.ctrlKey || e.metaKey || e.altKey) return;

  switch (e.key.toLowerCase()) {
    case 'j':
      return 'ArrowDown';
    case 'k':
      return 'ArrowUp';
    case 'h':
      return 'ArrowLeft';
    case 'l':
      return 'ArrowRight';
  }
}

export function handleCtrlJKMenuNavigation(
  e: KeyboardEvent,
  options?: CtrlJKMenuNavigationOptions | boolean
) {
  const resolved = resolveOptions(options);
  if (!resolved.enabled) return false;

  const key = translatedArrowKey(e, resolved.macOnly);
  if (!key) return false;

  e.preventDefault();
  e.stopPropagation();

  const target = e.target instanceof Element ? e.target : e.currentTarget;
  if (!(target instanceof Element)) return true;

  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      code: key,
      bubbles: true,
      cancelable: true,
      composed: true,
    })
  );

  return true;
}

export function addCtrlJKMenuNavigation(
  el: HTMLElement,
  options?: Accessor<CtrlJKMenuNavigationOptions | boolean | undefined>
) {
  const handleKeyDown = (e: KeyboardEvent) => {
    handleCtrlJKMenuNavigation(e, options?.());
  };

  el.addEventListener('keydown', handleKeyDown, { capture: true });

  return () => {
    el.removeEventListener('keydown', handleKeyDown, { capture: true });
  };
}

export function ctrlJKMenuNavigation(
  el: HTMLElement,
  options: Accessor<CtrlJKMenuNavigationOptions | boolean | undefined>
) {
  const cleanup = addCtrlJKMenuNavigation(el, options);
  onCleanup(cleanup);
}

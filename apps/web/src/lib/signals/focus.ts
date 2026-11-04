import {
  createEffect,
  createSignal,
  getOwner,
  on,
  onCleanup,
  onMount,
} from 'solid-js';

const [rawActiveElement, setRawActiveElement] = createSignal<Element | null>(
  document.activeElement
);

const [dirty, setDirty] = createSignal(undefined, { equals: () => false });

export function mountGlobalFocusListener(withDebug?: boolean) {
  const owner = getOwner();
  if (!owner) {
    console.error(
      'No owner. mountGlobalFocusListener should be called once - from within the component tree.'
    );
    return;
  }
  onMount(() => {
    document.addEventListener('focusin', setDirty);
    document.addEventListener('focusout', setDirty);
    // Removing a focused editor (or one of its ancestors) does not reliably
    // emit focusout. Reconcile after DOM changes so consumers cannot keep
    // treating a detached search input/composer as the active editor.
    const observer = new MutationObserver(() => {
      if (rawActiveElement() !== document.activeElement) setDirty();
    });
    observer.observe(document, { childList: true, subtree: true });
    onCleanup(() => {
      observer.disconnect();
      document.removeEventListener('focusin', setDirty);
      document.removeEventListener('focusout', setDirty);
    });
  });

  createEffect(
    on(dirty, () => {
      setRawActiveElement(document.activeElement);
    })
  );
  if (withDebug) {
    createEffect(() => {
      console.trace('### ACTIVE ELEMENT', rawActiveElement());
    });
  }
}

export const activeElement = rawActiveElement;
const _recheckFocus = () => setDirty();

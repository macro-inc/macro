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
    // Focus removal need not emit focusout. Watch only the focused element's
    // ancestor chain: mutations inside unrelated rows cannot change its focus.
    const observer = new MutationObserver(() => {
      if (rawActiveElement() !== document.activeElement) updateFocus();
    });
    const updateFocus = () => {
      setDirty();
      observer.disconnect();
      const focused = document.activeElement;
      if (!focused || focused === document.body) return;
      for (
        let parent = focused.parentNode;
        parent;
        parent = parent.parentNode
      ) {
        observer.observe(parent, { childList: true });
      }
    };
    document.addEventListener('focusin', updateFocus);
    document.addEventListener('focusout', updateFocus);
    updateFocus();
    onCleanup(() => {
      observer.disconnect();
      document.removeEventListener('focusin', updateFocus);
      document.removeEventListener('focusout', updateFocus);
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

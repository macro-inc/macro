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
    onCleanup(() => {
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
export const recheckFocus = () => setDirty();

import { onCleanup, onMount, type Setter } from 'solid-js';

interface ObservedSizeDirectiveOptions {
  setSize: Setter<DOMRect | undefined>;
  setInitialized?: Setter<boolean>;
}

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      observedSize: ObservedSizeDirectiveOptions;
      observedSizeBorderBox: ObservedSizeDirectiveOptions;
    }
  }
}

export function observedSize(
  element: Element,
  accessor: () => ObservedSizeDirectiveOptions
) {
  const { setSize, setInitialized } = accessor();
  const observer = new ResizeObserver((entries) => {
    const first = entries.at(0);
    if (first) {
      setSize(first.contentRect);
    }
  });

  onMount(() => {
    setSize(element.getBoundingClientRect());
    setInitialized?.(true);
    observer.observe(element);
  });
  onCleanup(() => observer.disconnect());
}

export function observedSizeBorderBox(
  element: Element,
  accessor: () => ObservedSizeDirectiveOptions
) {
  const { setSize, setInitialized } = accessor();
  const observer = new ResizeObserver((entries) => {
    const first = entries.at(0);
    if (first) {
      setSize(first.target.getBoundingClientRect());
    }
  });

  onMount(() => {
    setSize(element.getBoundingClientRect());
    setInitialized?.(true);
    observer.observe(element);
  });
  onCleanup(() => observer.disconnect());
}

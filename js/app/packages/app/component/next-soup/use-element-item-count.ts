import {
  createSignal,
  createEffect,
  onCleanup,
  type Accessor,
  createMemo,
} from 'solid-js';

const DEFAULT_HEIGHT = 600;

interface Options {
  element: Accessor<HTMLElement | undefined>;
  itemHeight: number;
}

export const useElementItemCount = (options: Options) => {
  let containerSizeObserver: ResizeObserver | null = null;

  const [containerHeight, setContainerHeight] = createSignal(DEFAULT_HEIGHT);

  createEffect(() => {
    containerSizeObserver?.disconnect();
    const ref = options.element();
    if (!ref) return;

    // Initialize with current size of the container using this component
    const initial =
      ref.clientHeight || ref.getBoundingClientRect().height || DEFAULT_HEIGHT;
    setContainerHeight((prevHeight) => Math.max(prevHeight, initial));

    containerSizeObserver = new ResizeObserver((entries) => {
      const last = entries.pop();
      const nextHeight = last?.contentRect?.height ?? ref.clientHeight;
      if (Number.isFinite(nextHeight) && nextHeight > 0)
        setContainerHeight((prevHeight) => Math.max(prevHeight, nextHeight));
    });
    containerSizeObserver.observe(ref);
    onCleanup(() => containerSizeObserver?.disconnect());
  });

  const viewportItemCount = createMemo(() =>
    Math.max(1, Math.ceil(containerHeight() / options.itemHeight))
  );

  return viewportItemCount;
};

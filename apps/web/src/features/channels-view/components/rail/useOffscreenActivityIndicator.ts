import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

type ActivityDirection = 'start' | 'end';

export function useOffscreenActivityIndicator(options: {
  scrollRoot: Accessor<HTMLDivElement | undefined>;
  targetId: Accessor<string | undefined>;
  onTargetVisible?: (targetId: string) => void;
}) {
  const [direction, setDirection] = createSignal<ActivityDirection>();
  let measuredTargetId: string | undefined;

  const update = (root: HTMLDivElement) => {
    const targetId = options.targetId();
    if (!targetId) {
      measuredTargetId = undefined;
      setDirection(undefined);
      return;
    }

    if (targetId !== measuredTargetId) {
      measuredTargetId = targetId;
      setDirection(undefined);
    }

    const target = document.getElementById(targetId);
    if (!target) {
      setDirection(undefined);
      return;
    }

    const rootBounds = root.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    const targetIsVisible =
      targetBounds.bottom > rootBounds.top &&
      targetBounds.top < rootBounds.bottom;

    if (targetIsVisible || root.scrollHeight <= root.clientHeight + 1) {
      const wasOffscreen = direction() !== undefined;
      setDirection(undefined);
      if (wasOffscreen) options.onTargetVisible?.(targetId);
      return;
    }

    setDirection(targetBounds.bottom <= rootBounds.top ? 'start' : 'end');
  };

  createEffect(() => {
    const root = options.scrollRoot();
    if (!root) {
      setDirection(undefined);
      return;
    }

    measuredTargetId = undefined;
    const updateForRoot = () => update(root);
    root.addEventListener('scroll', updateForRoot, { passive: true });

    const resizeObserver = new ResizeObserver(updateForRoot);
    resizeObserver.observe(root);
    if (root.firstElementChild instanceof HTMLElement) {
      resizeObserver.observe(root.firstElementChild);
    }

    const mutationObserver = new MutationObserver(updateForRoot);
    mutationObserver.observe(root, { childList: true, subtree: true });

    queueMicrotask(updateForRoot);

    onCleanup(() => {
      root.removeEventListener('scroll', updateForRoot);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    });
  });

  createEffect(() => {
    options.targetId();
    const root = options.scrollRoot();
    if (!root) return;

    queueMicrotask(() => {
      if (root === options.scrollRoot()) update(root);
    });
  });

  const scrollToTarget = () => {
    const root = options.scrollRoot();
    const targetId = options.targetId();
    const target = targetId ? document.getElementById(targetId) : undefined;
    if (!root || !target) return;

    const rootBounds = root.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    const rootCenter = rootBounds.top + rootBounds.height / 2;
    const targetCenter = targetBounds.top + targetBounds.height / 2;

    root.scrollTo({
      top: root.scrollTop + targetCenter - rootCenter,
      behavior: 'smooth',
    });
  };

  return { direction, scrollToTarget };
}

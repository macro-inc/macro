import {
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
} from 'solid-js';

/**
 * Wraps an expensive decorator in a viewport-gated placeholder. Renders the
 * cheap `placeholder` slot synchronously; calls `render` (instantiating the
 * heavy component) only once the wrapper intersects the viewport, then keeps
 * the upgraded content mounted to avoid flicker on small scrolls.
 * One shared `IntersectionObserver` services all instances in the document.
 */

const OBSERVER_OPTS: IntersectionObserverInit = {
  // Upgrade slightly before scrolling into view so users don't see a flash
  // of placeholder content.
  rootMargin: '400px 0px',
  threshold: 0,
};

const upgradeCallbacks = new WeakMap<Element, () => void>();
let sharedObserver: IntersectionObserver | undefined;

function getSharedObserver(): IntersectionObserver {
  if (sharedObserver) return sharedObserver;
  sharedObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const cb = upgradeCallbacks.get(entry.target);
      if (cb) cb();
    }
  }, OBSERVER_OPTS);
  return sharedObserver;
}

export function LazyDecorator(props: {
  placeholder: JSX.Element;
  render: () => JSX.Element;
}): JSX.Element {
  const [upgraded, setUpgraded] = createSignal(false);
  let el: HTMLSpanElement | undefined;

  onMount(() => {
    if (!el) return;
    const observer = getSharedObserver();
    const upgrade = () => {
      observer.unobserve(el!);
      upgradeCallbacks.delete(el!);
      setUpgraded(true);
    };
    upgradeCallbacks.set(el, upgrade);
    observer.observe(el);
  });

  onCleanup(() => {
    if (!el) return;
    upgradeCallbacks.delete(el);
    sharedObserver?.unobserve(el);
  });

  const content = createMemo(() =>
    upgraded() ? props.render() : props.placeholder
  );

  return (
    <span
      ref={(r) => {
        el = r;
      }}
      class="inline"
    >
      {content()}
    </span>
  );
}

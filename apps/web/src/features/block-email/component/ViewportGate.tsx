import {
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
} from 'solid-js';

const OBSERVER_OPTS: IntersectionObserverInit = {
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

/**
 * Defers expensive subtree mount until near the viewport. Keeps upgraded
 * content mounted to avoid flicker on small scrolls.
 */
export function ViewportGate(props: {
  eager?: boolean;
  placeholder: JSX.Element;
  children: JSX.Element;
}): JSX.Element {
  const [upgraded, setUpgraded] = createSignal(Boolean(props.eager));
  let el: HTMLDivElement | undefined;

  onMount(() => {
    if (props.eager || !el) return;
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
    upgraded() ? props.children : props.placeholder
  );

  return (
    <div
      ref={(node) => {
        el = node;
      }}
      class="min-w-0"
    >
      {content()}
    </div>
  );
}

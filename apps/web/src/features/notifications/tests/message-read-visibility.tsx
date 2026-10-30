import { type ComponentProps, createSignal } from 'solid-js';
import { vi } from 'vitest';
import { MarkMessageNotifications } from '../components/MarkMessageNotifications';
import { MessageReadVisibilityProvider } from '../components/MessageReadVisibility';

/** jsdom has no layout; tests deliver browser intersection events explicitly. */
export function installMessageIntersectionObserver() {
  const observers = new Set<TestObserver>();
  class TestObserver implements IntersectionObserver {
    readonly root: Element | Document | null;
    readonly rootMargin: string;
    readonly scrollMargin = '0px';
    readonly thresholds = [0.001];
    readonly targets = new Set<Element>();
    constructor(
      private callback: IntersectionObserverCallback,
      options?: IntersectionObserverInit
    ) {
      this.root = options?.root ?? null;
      this.rootMargin = options?.rootMargin ?? '0px';
      observers.add(this);
    }
    observe(element: Element) {
      this.targets.add(element);
    }
    unobserve(element: Element) {
      this.targets.delete(element);
    }
    disconnect() {
      this.targets.clear();
      observers.delete(this);
    }
    takeRecords() {
      return [];
    }
    queue(visible: boolean, time: number) {
      const entries = [...this.targets].map((target) => ({
        target,
        isIntersecting: visible,
        intersectionRatio: visible ? 1 : 0,
        intersectionRect: new DOMRect(0, 0, 200, visible ? 50 : 0),
        boundingClientRect: new DOMRect(0, 0, 200, 50),
        rootBounds: null,
        time,
      }));
      return () => this.callback(entries, this);
    }
  }
  vi.stubGlobal('IntersectionObserver', TestObserver);
  const queue = (visible = true) => {
    const time = performance.now();
    const deliveries = [...observers].map((observer) =>
      observer.queue(visible, time)
    );
    return () => {
      for (const deliver of deliveries) deliver();
    };
  };
  return Object.assign((visible = true) => queue(visible)(), { queue });
}

export function ObservedMessage(
  props: Omit<ComponentProps<typeof MarkMessageNotifications>, 'element'>
) {
  const [element, setElement] = createSignal<HTMLSpanElement>();
  return (
    <MessageReadVisibilityProvider>
      <MarkMessageNotifications {...props} element={element()}>
        <span ref={setElement}>{props.children}</span>
      </MarkMessageNotifications>
    </MessageReadVisibilityProvider>
  );
}

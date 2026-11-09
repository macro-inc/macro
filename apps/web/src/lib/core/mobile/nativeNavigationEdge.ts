import { createSignal, onCleanup } from 'solid-js';

/** UIKit owns the edge, including changes between Duo poses and Split View. */
export function useNativeNavigationEdge() {
  const root = document.documentElement;
  const read = (): 'left' | 'right' | 'bottom' => {
    const edge = root.dataset.nativeNavigationEdge;
    return edge === 'left' || edge === 'right' ? edge : 'bottom';
  };
  const [edge, setEdge] = createSignal(read());
  const observer = new MutationObserver(() => setEdge(read()));
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['data-native-navigation-edge'],
  });
  onCleanup(() => observer.disconnect());
  return edge;
}

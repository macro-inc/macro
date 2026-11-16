import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';

export interface ScrollEdgeSource {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  addEventListener(
    type: 'scroll',
    listener: () => void,
    options: { passive: true }
  ): void;
  removeEventListener(type: 'scroll', listener: () => void): void;
}

/** Tracks a sheet's scroll edges without owning or replacing its scroller. */
export function createScrollEdges(
  source: Accessor<ScrollEdgeSource | undefined>,
  observeResize: (source: ScrollEdgeSource, update: () => void) => () => void
) {
  const [edges, setEdges] = createStore({ above: false, below: false });
  createEffect(
    on(source, (scroller) => {
      if (!scroller) {
        setEdges({ above: false, below: false });
        return;
      }
      const update = () =>
        setEdges({
          above: scroller.scrollTop > 1,
          below:
            scroller.scrollTop + scroller.clientHeight <
            scroller.scrollHeight - 1,
        });
      scroller.addEventListener('scroll', update, { passive: true });
      const stopObserving = observeResize(scroller, update);
      update();
      onCleanup(() => {
        scroller.removeEventListener('scroll', update);
        stopObserving();
      });
    })
  );
  return edges;
}

import { cn } from '@ui';
import {
  type Accessor,
  createEffect,
  on,
  onCleanup,
  type ParentProps,
} from 'solid-js';
import { createStore } from 'solid-js/store';

/** Tracks whether the sheet scroller has content below its visible viewport. */
function createScrollEdges(source: Accessor<HTMLElement | undefined>) {
  const [edges, setEdges] = createStore({ below: false });
  createEffect(
    on(source, (scroller) => {
      if (!scroller) {
        setEdges({ below: false });
        return;
      }
      const update = () =>
        setEdges({
          below:
            scroller.scrollTop + scroller.clientHeight <
            scroller.scrollHeight - 1,
        });
      scroller.addEventListener('scroll', update, { passive: true });
      const observer = new ResizeObserver(update);
      observer.observe(scroller);
      for (const child of scroller.children) observer.observe(child);
      update();
      onCleanup(() => {
        scroller.removeEventListener('scroll', update);
        observer.disconnect();
      });
    })
  );
  return edges;
}

export type SheetFooterProps = ParentProps & {
  scrollElement: Accessor<HTMLElement | undefined>;
  keyboardVisible?: boolean;
  class?: string;
};

/** Pinned actions with a surface fade only while more content is below. */
export function SheetFooter(props: SheetFooterProps) {
  const edges = createScrollEdges(props.scrollElement);

  return (
    <footer
      class={cn(
        'relative shrink-0 px-5 pt-3',
        props.keyboardVisible
          ? 'pb-4'
          : 'pb-[max(26px,var(--safe-bottom,0px))]',
        props.class
      )}
    >
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-x-0 bottom-full h-5 bg-linear-to-t from-menu to-transparent transition-opacity motion-reduce:transition-none"
        style={{ opacity: edges.below ? 1 : 0 }}
      />
      {props.children}
    </footer>
  );
}

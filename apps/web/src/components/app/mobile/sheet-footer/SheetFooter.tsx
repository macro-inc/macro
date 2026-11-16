import { cn } from '@ui';
import type { Accessor, ParentProps } from 'solid-js';
import { createScrollEdges } from '../primitives/scroll-edges';

export interface SheetFooterProps extends ParentProps {
  scrollElement: Accessor<HTMLElement | undefined>;
  keyboardVisible?: boolean;
  class?: string;
}

/** Pinned actions with a surface fade only while more content is below. */
export function SheetFooter(props: SheetFooterProps) {
  const edges = createScrollEdges(props.scrollElement, (_source, update) => {
    const element = props.scrollElement();
    if (!element) return () => {};
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => observer.disconnect();
  });

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

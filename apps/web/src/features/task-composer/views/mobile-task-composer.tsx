import { onElementConnect } from '@core/util/onElementConnect';
import { cn, EntityComposer } from '@ui';
import { createSignal, onCleanup } from 'solid-js';
import type { TaskComposerController } from '../primitives/task-composer';
import { TaskComposer } from './task-composer-parts';

/** The task composer in the touch bottom sheet. */
export function MobileTaskComposer(props: {
  composer: TaskComposerController;
}) {
  // The keyboard leaves too little room for the whole composer, so the header
  // pins to the top of the sheet's scroll to keep Create Task in reach. It
  // only takes a background while pinned over content; at rest it would show
  // as a band against the glass sheet.
  const [headerPinned, setHeaderPinned] = createSignal(false);
  const observeHeader = (header: HTMLElement) => {
    onElementConnect(header, () => {
      const observer = new IntersectionObserver(
        ([entry]) => setHeaderPinned(!!entry && entry.intersectionRatio < 1),
        {
          root: header.closest('[data-drawer-scroll-body]'),
          // Pinned at -1px, the header's top pixel leaves the scroll viewport.
          threshold: 1,
        }
      );
      observer.observe(header);
      onCleanup(() => observer.disconnect());
    });
  };

  return (
    <TaskComposer.Root composer={props.composer}>
      <EntityComposer.Header
        ref={observeHeader}
        class={cn(
          // -mt-4 and pt-4 offset the composer's padding so the header rests
          // where it would have been.
          'sticky -top-px z-1 -mx-4 -mt-4 -mb-3 px-4 pt-4 pb-3',
          headerPinned() && 'bg-menu'
        )}
      >
        <div class="flex-1 flex items-center">
          <TaskComposer.ContinueInSplit />
        </div>
        {/* Far enough from Create Task that a tap meant for one cannot land
            on the other. */}
        <div class="flex items-center gap-8">
          <TaskComposer.Clear />
          <TaskComposer.Submit />
        </div>
      </EntityComposer.Header>
      <TaskComposer.Recovery />
      {/* The sheet sizes the composer to its content, so nothing needs
          clipping, and the property row can scroll to the sheet's edges. */}
      <EntityComposer.Main class="overflow-visible">
        <TaskComposer.Title />
        <TaskComposer.Body />
        <div class="shrink-0 flex items-center py-2">
          <TaskComposer.Attach />
        </div>
        <div class="-mx-4 shrink-0 overflow-x-auto overscroll-x-contain scrollbar-hidden">
          <TaskComposer.Properties class="w-max flex-nowrap px-4" />
        </div>
      </EntityComposer.Main>
      <TaskComposer.ErrorMessage />
      {/* Hidden when there is neither a team nor a source to link back to. */}
      <EntityComposer.Footer class="items-center empty:hidden">
        <TaskComposer.ShareToggle />
        <TaskComposer.LinkInSourceToggle />
      </EntityComposer.Footer>
    </TaskComposer.Root>
  );
}

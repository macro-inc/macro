import { onElementConnect } from '@core/util/onElementConnect';
import { Property } from '@property';
import { InlineTagsSheetPill } from '@property/tags';
import { cn, EntityComposer } from '@ui';
import { createSignal, onCleanup } from 'solid-js';
import type { TaskComposerController } from '../../primitives/task-composer';
import { TaskComposerParts } from '../shared/task-composer-parts';

/** The task composer in the touch bottom sheet. */
export function MobileTaskComposer(props: {
  composer: TaskComposerController;
}) {
  // Opens taller than its content, the description taking the room above the
  // properties.
  props.composer.fillSheet();
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
  // Tapping a pill leaves focus in the title or description, so the keyboard
  // stays up under a menu and a picker sheet can hand it back.
  const keepTypingFocus = (event: PointerEvent | MouseEvent) => {
    if ((event.target as Element).closest('button')) event.preventDefault();
  };

  return (
    <TaskComposerParts.Root
      composer={props.composer}
      tagsPill={InlineTagsSheetPill}
      propertyEditor={Property.SheetEditor}
    >
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
          <TaskComposerParts.ContinueInSplit />
        </div>
        {/* Far enough from Create Task that a tap meant for one cannot land
            on the other. */}
        <div class="flex items-center gap-8">
          <TaskComposerParts.Clear />
          <TaskComposerParts.Submit />
        </div>
      </EntityComposer.Header>
      <TaskComposerParts.Recovery />
      {/* The sheet scrolls rather than shrinking the composer below its
          content, so nothing needs clipping, and the property row can scroll
          to the sheet's edges. */}
      <EntityComposer.Main
        class="overflow-visible"
        onPointerDown={keepTypingFocus}
        onMouseDown={keepTypingFocus}
      >
        <TaskComposerParts.Title />
        <TaskComposerParts.Body />
        <div class="shrink-0 flex items-center py-2">
          <TaskComposerParts.Attach />
        </div>
        <div class="-mx-4 shrink-0 overflow-x-auto overscroll-x-contain scrollbar-hidden">
          <TaskComposerParts.Properties class="w-max flex-nowrap px-4" />
        </div>
      </EntityComposer.Main>
      <TaskComposerParts.ErrorMessage />
      {/* Hidden when there is neither a team nor a source to link back to. */}
      <EntityComposer.Footer class="items-center empty:hidden">
        <TaskComposerParts.ShareToggle />
        <TaskComposerParts.LinkInSourceToggle />
      </EntityComposer.Footer>
    </TaskComposerParts.Root>
  );
}

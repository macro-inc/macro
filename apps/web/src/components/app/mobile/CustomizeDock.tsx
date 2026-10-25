import { DragSessionSensors } from '@app/components/drag-drop/drag-session-sensors';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import DotsSixVerticalIcon from '@phosphor/dots-six-vertical.svg';
import {
  closestCenter,
  createSortable,
  DragDropProvider,
  DragOverlay,
  maybeTransformStyle,
  SortableProvider,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { Button, cn } from '@ui';
import { createSignal, For, onMount, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { createDockTouchSensor } from './create-dock-touch-sensor';
import { MobileDrawer } from './MobileDrawer';
import type { MobileDockView } from './mobile-dock-views';

function DockOrderRow(props: {
  view: MobileDockView;
  index: number;
  count: number;
  attachTouch: (element: HTMLElement, id: string) => void;
  onMove: (from: number, to: number) => void;
}) {
  const sortable = createSortable(props.view.id);
  const [dragState] = useDragDropContext() ?? [];
  return (
    <div
      ref={sortable.ref}
      style={maybeTransformStyle(sortable.transform)}
      data-dock-order-item={props.view.id}
      class={cn(
        'flex min-h-14 items-center gap-3 rounded-2xl bg-ink/5 pl-4 text-sm',
        !!dragState?.active.draggable &&
          !sortable.isActiveDraggable &&
          'transition-transform duration-200 ease-out motion-reduce:transition-none',
        sortable.isActiveDraggable && 'opacity-30'
      )}
    >
      <Dynamic
        component={props.view.icon}
        class="size-5 shrink-0 text-ink-muted"
      />
      <span class="flex-1">{props.view.label}</span>
      <Button
        {...sortable.dragActivators}
        ref={(element) => props.attachTouch(element, props.view.id)}
        type="button"
        variant="ghost"
        size="icon-lg"
        aria-label={`Reorder ${props.view.label}`}
        aria-description={`Position ${props.index + 1} of ${props.count}. Drag, or use the up and down arrow keys.`}
        class="flex size-14 shrink-0 cursor-grab touch-none data-[touch-pressed]:bg-ink/10 select-none items-center justify-center rounded-2xl text-ink-muted active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-accent [-webkit-touch-callout:none]"
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          props.onMove(
            props.index,
            props.index + (event.key === 'ArrowUp' ? -1 : 1)
          );
          event.currentTarget.focus({ preventScroll: true });
        }}
      >
        <DotsSixVerticalIcon class="size-6" />
      </Button>
    </div>
  );
}

function DockOrderList(props: {
  views: readonly MobileDockView[];
  visibleCount: number;
  onMove: (from: number, to: number) => void;
  onCancel: () => void;
}) {
  let viewport: HTMLDivElement | undefined;
  const attachTouch = createDockTouchSensor(props.onCancel);
  return (
    <>
      <DragSessionSensors
        getViewport={() => viewport}
        axis="both"
        activationDistance={8}
        onCancel={props.onCancel}
      />
      <MobileDrawer.ScrollBody ref={viewport} class="px-4">
        <SortableProvider ids={props.views.map((view) => view.id)}>
          <div class="flex flex-col gap-1">
            <div class="px-2 pb-2 pt-1 text-xs font-medium text-ink-muted">
              In dock · {props.visibleCount}
            </div>
            <For each={props.views}>
              {(view, index) => (
                <>
                  <Show when={index() === props.visibleCount}>
                    <div class="mt-3 border-t border-edge px-2 pb-2 pt-4 text-xs font-medium text-ink-muted">
                      In More · {props.views.length - props.visibleCount}
                    </div>
                  </Show>
                  <DockOrderRow
                    view={view}
                    index={index()}
                    count={props.views.length}
                    attachTouch={attachTouch}
                    onMove={props.onMove}
                  />
                </>
              )}
            </For>
          </div>
        </SortableProvider>
      </MobileDrawer.ScrollBody>
      <DragOverlay class="z-drag pointer-events-none">
        {(draggable) => (
          <Show when={props.views.find((view) => view.id === draggable?.id)}>
            {(view) => (
              <div class="flex min-h-14 items-center gap-3 rounded-2xl bg-menu px-4 text-sm text-ink shadow-lg">
                <Dynamic component={view().icon} class="size-5" />
                <span class="flex-1">{view().label}</span>
                <DotsSixVerticalIcon class="size-6" />
              </div>
            )}
          </Show>
        )}
      </DragOverlay>
    </>
  );
}

export function CustomizeDock(props: {
  views: readonly MobileDockView[];
  visibleCount: number;
  onBack: () => void;
  onMove: (from: number, to: number) => void;
}) {
  let backButton: HTMLButtonElement | undefined;
  onMount(() => backButton?.focus({ preventScroll: true }));
  let cancelled = false;
  const [announcement, setAnnouncement] = createSignal('');
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= props.views.length) return;
    const view = props.views[from];
    if (!view) return;
    props.onMove(from, to);
    setAnnouncement(
      `${view.label} moved to position ${to + 1}, ${to < props.visibleCount ? 'in dock' : 'in More'}.`
    );
  };
  return (
    <>
      <div class="flex items-center gap-2 px-4 pb-2">
        <Button
          type="button"
          ref={backButton}
          aria-label="Back to More views"
          variant="ghost"
          size="icon-lg"
          class="size-11"
          onClick={props.onBack}
        >
          <CaretLeftIcon class="size-5" />
        </Button>
        <MobileDrawer.Title class="flex-1 text-lg font-semibold">
          Customize dock
        </MobileDrawer.Title>
        <MobileDrawer.Close
          as={Button}
          variant="ghost"
          aria-label="Done"
          class="min-h-11 px-3 text-sm font-medium text-accent"
        >
          Done
        </MobileDrawer.Close>
      </div>
      <MobileDrawer.Description class="px-6 pb-4 text-sm text-ink-muted">
        Drag a handle to reorder. {props.visibleCount} app{' '}
        {props.visibleCount === 1 ? 'fits' : 'buttons fit'} in your dock at this
        size. Search and More stay fixed. Changes save automatically.
      </MobileDrawer.Description>
      <span role="status" class="sr-only">
        {announcement()}
      </span>
      <DragDropProvider
        collisionDetector={closestCenter}
        onDragStart={() => {
          cancelled = false;
        }}
        onDragEnd={({ draggable, droppable }) => {
          if (cancelled || !droppable) return;
          move(
            props.views.findIndex((view) => view.id === draggable.id),
            props.views.findIndex((view) => view.id === droppable.id)
          );
        }}
      >
        <DockOrderList
          views={props.views}
          visibleCount={props.visibleCount}
          onMove={move}
          onCancel={() => {
            cancelled = true;
          }}
        />
      </DragDropProvider>
    </>
  );
}

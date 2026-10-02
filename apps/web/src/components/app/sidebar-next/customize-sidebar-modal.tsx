import type { ItemDragOverlayData } from '@app/components/app/ItemDragAndDrop';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CaretUpIcon from '@phosphor/caret-up.svg';
import DotsSixVerticalIcon from '@phosphor/dots-six-vertical.svg';
import CloseIcon from '@phosphor/x.svg';
import {
  createSortable,
  maybeTransformStyle,
  SortableProvider,
  useDragDropContext,
  useSortableContext,
} from '@thisbeyond/solid-dnd';
import { Button, Checkbox, cn, Dialog, Panel, Tooltip } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  customizableNavItems,
  type NavItemGates,
  type SidebarNextNavItem,
} from './nav-items';
import {
  reorderSidebarItems,
  setSidebarItemVisible,
} from './use-sidebar-prefs';

type SidebarNavDragData = ItemDragOverlayData & {
  dragType: 'sidebar-nav';
  name: string;
};

const [customizeSidebarOpen, setCustomizeSidebarOpen] = createSignal(false);

export { setCustomizeSidebarOpen };

function useNavReorderMode(): 'drag' | 'buttons' {
  const canDrag =
    useDragDropContext() !== null && useSortableContext() !== null;
  return canDrag && !isTouchDevice() ? 'drag' : 'buttons';
}

function CustomizeNavList(props: { ids: string[]; children: JSX.Element }) {
  const dnd = useDragDropContext();
  return (
    <Show when={dnd !== null} fallback={props.children}>
      <SortableProvider ids={props.ids}>{props.children}</SortableProvider>
    </Show>
  );
}

function CustomizeNavRow(props: {
  item: SidebarNextNavItem;
  checked: boolean;
  index: number;
  count: number;
  onMove: (direction: -1 | 1) => void;
}) {
  const isHome = () => props.item.id === 'home';
  const canMoveUp = () => !isHome() && props.index > 1;
  const canMoveDown = () => !isHome() && props.index < props.count - 1;
  const reorderMode = useNavReorderMode();
  const [dndState] = useDragDropContext() ?? [];

  const sortable =
    !isHome() && reorderMode === 'drag'
      ? createSortable(props.item.id, {
          dragType: 'sidebar-nav',
          get name() {
            return props.item.label;
          },
          overlayIcon: () => (
            <Dynamic component={props.item.icon} class="size-4" />
          ),
        } satisfies SidebarNavDragData)
      : undefined;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    if (isHome()) return;
    if (e.key === 'ArrowUp' && canMoveUp()) props.onMove(-1);
    if (e.key === 'ArrowDown' && canMoveDown()) props.onMove(1);
  };

  return (
    <div
      ref={sortable?.ref}
      style={sortable ? maybeTransformStyle(sortable.transform) : undefined}
      class={cn(
        'flex items-center gap-2 rounded-lg px-2 py-1.5',
        !!dndState?.active.draggable && 'transition-transform',
        sortable?.isActiveDraggable && 'opacity-40'
      )}
    >
      <Show
        when={!isHome()}
        fallback={<span class="size-7 shrink-0" aria-hidden="true" />}
      >
        <Show
          when={reorderMode === 'drag' && sortable}
          fallback={
            <div class="flex shrink-0 flex-col">
              <Button
                variant="ghost"
                size="icon-sm"
                class="size-6"
                label={`Move ${props.item.label} up`}
                disabled={!canMoveUp()}
                onClick={() => props.onMove(-1)}
              >
                <CaretUpIcon class="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                class="size-6"
                label={`Move ${props.item.label} down`}
                disabled={!canMoveDown()}
                onClick={() => props.onMove(1)}
              >
                <CaretDownIcon class="size-3" />
              </Button>
            </div>
          }
        >
          <Tooltip label="Drag to reorder">
            <Button
              {...(sortable?.dragActivators ?? {})}
              aria-label={`Reorder ${props.item.label}`}
              variant="ghost"
              size="icon-sm"
              class="size-7 cursor-grab touch-none active:cursor-grabbing"
              onKeyDown={handleKeyDown}
            >
              <DotsSixVerticalIcon class="size-4 text-ink-muted" />
            </Button>
          </Tooltip>
        </Show>
      </Show>

      <Checkbox
        checked={props.checked}
        disabled={isHome()}
        onChange={(checked) => setSidebarItemVisible(props.item.id, checked)}
        class="min-w-0 flex-1 cursor-default"
      >
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
        <Checkbox.Label class="flex min-w-0 flex-1 items-center gap-2 text-sm text-ink">
          <Dynamic
            component={props.item.icon}
            class="size-4 shrink-0 text-ink-muted"
          />
          <span class="min-w-0 truncate">{props.item.label}</span>
        </Checkbox.Label>
      </Checkbox>
    </div>
  );
}

/**
 * Center modal for showing/hiding and reordering outer sidebar items.
 * Opened from the More menu's "Customize sidebar" action.
 */
export function CustomizeSidebarModal(props: { gates: NavItemGates }) {
  const items = () => customizableNavItems(props.gates);
  const orderIds = () => items().map((item) => item.id);
  const sortableIds = () => orderIds().filter((id) => id !== 'home');

  const [, dndActions] = useDragDropContext() ?? [];
  dndActions?.onDragEnd(({ draggable, droppable }) => {
    if (draggable.data.dragType !== 'sidebar-nav') return;
    if (!droppable || droppable.data.dragType !== 'sidebar-nav') return;
    const ids = orderIds();
    reorderSidebarItems(
      ids.indexOf(String(draggable.id)),
      ids.indexOf(String(droppable.id)),
      ids
    );
  });

  const moveByDirection = (itemId: string, direction: -1 | 1) => {
    const ids = orderIds();
    const from = ids.indexOf(itemId);
    if (from < 0) return;
    reorderSidebarItems(from, from + direction, ids);
  };

  return (
    <Dialog
      open={customizeSidebarOpen()}
      onOpenChange={setCustomizeSidebarOpen}
      position="center"
      animate
      class="w-96 max-w-[calc(100vw-16px)]"
    >
      <Panel depth={2} class="max-h-[75vh] text-ink rounded-xl">
        <Panel.Header class="px-2 gap-1">
          <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
            <CloseIcon />
          </Dialog.CloseButton>
          <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
            Customize sidebar
          </Dialog.Title>
        </Panel.Header>

        <Panel.Body scroll class="p-2">
          <Dialog.Description class="px-2 pb-2 text-sm text-ink-muted">
            Choose which apps appear in the sidebar and drag to reorder them.
            Home always stays first.
          </Dialog.Description>

          <CustomizeNavList ids={sortableIds()}>
            <For each={items()}>
              {(item, index) => (
                <CustomizeNavRow
                  item={item}
                  checked={
                    item.id === 'home' || !props.gates.prefs.hidden.has(item.id)
                  }
                  index={index()}
                  count={items().length}
                  onMove={(direction) => moveByDirection(item.id, direction)}
                />
              )}
            </For>
          </CustomizeNavList>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}

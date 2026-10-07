import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { ContextMenu } from '@kobalte/core/context-menu';
import ArrowLeft from '@phosphor/arrow-left.svg';
import ArrowRight from '@phosphor/arrow-right.svg';
import CaretDown from '@phosphor/caret-down.svg';
import Copy from '@phosphor/copy.svg';
import Pencil from '@phosphor/pencil-simple.svg';
import Plus from '@phosphor/plus.svg';
import Trash from '@phosphor/trash-simple.svg';
import { Button } from '@ui/components/Button';
import { Dropdown } from '@ui/components/Dropdown';
import { Tooltip } from '@ui/components/Tooltip';
import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js';

/** Pointer travel before a press on a tab becomes a drag. */
const DRAG_THRESHOLD = 4;
/** Distance from the tab strip's edge that scrolls it during a drag. */
const DRAG_SCROLL_EDGE = 24;

export type SpreadsheetSheetTabsProps = {
  sheets: { id: string; name: string }[];
  activeSheetId: string;
  readonly: boolean;
  canAdd: boolean;
  preserveEditorFocus?: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  /** Move a sheet to `index` in `sheets`. */
  onMove: (id: string, index: number) => void;
  onAddRows?: () => void;
  addRowsLabel?: string;
};

function SheetActions(props: SpreadsheetSheetTabsProps) {
  const active = () =>
    props.sheets.find((sheet) => sheet.id === props.activeSheetId);
  const activeIndex = () =>
    props.sheets.findIndex((sheet) => sheet.id === props.activeSheetId);
  let pendingAction: (() => void) | undefined;
  function move(offset: number) {
    const sheet = active();
    if (sheet && !props.readonly)
      props.onMove(sheet.id, activeIndex() + offset);
  }

  function defer(action: (id: string) => void) {
    const sheet = active();
    if (!sheet || props.readonly) return;
    pendingAction = () => action(sheet.id);
  }

  return (
    <Dropdown placement="top-end">
      <Dropdown.Trigger
        label={`Sheet actions for ${active()?.name ?? 'current sheet'}`}
        variant="ghost"
        size="icon-sm"
        class="h-7 w-7 shrink-0 touch:h-[44px] touch:w-[44px] touch:min-h-[44px] touch:min-w-[44px]"
        disabled={props.readonly || !active()}
      >
        <CaretDown class="size-3.5" />
      </Dropdown.Trigger>
      <Dropdown.Content
        class="min-w-44 max-h-[min(30rem,70dvh)] max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain touch:text-[max(14px,0.875rem)] touch:[&_[role=menuitem]]:min-h-[44px]"
        onCloseAutoFocus={(event) => {
          const action = pendingAction;
          pendingAction = undefined;
          if (!action) return;
          event.preventDefault();
          // Wait until Kobalte has finished restoring the menu trigger before
          // opening a dialog or switching the newly duplicated sheet.
          queueMicrotask(action);
        }}
      >
        <Dropdown.Group>
          <Dropdown.Item
            closeOnSelect
            disabled={props.readonly}
            onSelect={() => defer(props.onRename)}
          >
            <Pencil class="size-4" />
            Rename
          </Dropdown.Item>
          <Dropdown.Item
            closeOnSelect
            disabled={props.readonly || !props.canAdd}
            onSelect={() => defer(props.onDuplicate)}
          >
            <Copy class="size-4" />
            Duplicate
          </Dropdown.Item>
        </Dropdown.Group>
        <Dropdown.Group>
          <Dropdown.Item
            closeOnSelect
            disabled={props.readonly || activeIndex() <= 0}
            onSelect={() => move(-1)}
          >
            <ArrowLeft class="size-4" />
            Move left
          </Dropdown.Item>
          <Dropdown.Item
            closeOnSelect
            disabled={
              props.readonly ||
              activeIndex() < 0 ||
              activeIndex() >= props.sheets.length - 1
            }
            onSelect={() => move(1)}
          >
            <ArrowRight class="size-4" />
            Move right
          </Dropdown.Item>
        </Dropdown.Group>
        <Show when={props.onAddRows && isMobileWidth()}>
          <Dropdown.Group>
            <Dropdown.Item
              closeOnSelect
              disabled={props.readonly}
              onSelect={() => {
                if (!props.readonly) pendingAction = props.onAddRows;
              }}
            >
              <Plus class="size-4" />
              {props.addRowsLabel ?? 'Add rows'}
            </Dropdown.Item>
          </Dropdown.Group>
        </Show>
        <Dropdown.Group>
          <Dropdown.Item
            closeOnSelect
            disabled={props.readonly || props.sheets.length < 2}
            class="text-failure"
            onSelect={() => defer(props.onDelete)}
          >
            <Trash class="size-4" />
            Delete
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

/** Workbook navigation stays local; the owner supplies mutations and dialogs. */
export function SpreadsheetSheetTabs(props: SpreadsheetSheetTabsProps) {
  const buttons = new Map<string, HTMLButtonElement>();
  let list: HTMLDivElement | undefined;
  const [dragging, setDragging] = createSignal<string>();
  /** Insertion point among the tabs, from 0 to `sheets.length`. */
  const [dropAt, setDropAt] = createSignal<number>();
  let endDrag: (() => void) | undefined;
  onCleanup(() => endDrag?.());

  const indexOf = (id: string) =>
    props.sheets.findIndex((sheet) => sheet.id === id);
  /** The moved sheet's resulting index, or undefined when it stays put. */
  const target = (id: string, at: number) => {
    const from = indexOf(id);
    if (from < 0) return;
    const to = at > from ? at - 1 : at;
    return to === from ? undefined : to;
  };
  const showDrop = (at: number) => {
    const id = dragging();
    return id !== undefined && dropAt() === at && target(id, at) !== undefined;
  };

  function move(id: string, index: number) {
    if (props.readonly) return;
    props.onMove(id, index);
    const button = buttons.get(id);
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function insertionPoint(clientX: number) {
    const index = props.sheets.findIndex((sheet) => {
      const rect = buttons.get(sheet.id)?.getBoundingClientRect();
      return rect && clientX < rect.left + rect.width / 2;
    });
    return index < 0 ? props.sheets.length : index;
  }

  /** Mouse and pen presses drag; touch keeps scrolling the strip. Window
   * listeners survive the tab remounting while it is dragged. */
  function startDrag(event: PointerEvent, id: string) {
    if (
      event.button !== 0 ||
      event.pointerType === 'touch' ||
      props.readonly ||
      props.preserveEditorFocus ||
      props.sheets.length < 2
    )
      return;
    endDrag?.();
    const startX = event.clientX;
    const pointerId = event.pointerId;
    const onMove = (moved: PointerEvent) => {
      if (moved.pointerId !== pointerId) return;
      if (!dragging()) {
        if (Math.abs(moved.clientX - startX) < DRAG_THRESHOLD) return;
        setDragging(id);
      }
      moved.preventDefault();
      if (list) {
        const rect = list.getBoundingClientRect();
        if (moved.clientX < rect.left + DRAG_SCROLL_EDGE)
          list.scrollLeft -= DRAG_SCROLL_EDGE / 2;
        else if (moved.clientX > rect.right - DRAG_SCROLL_EDGE)
          list.scrollLeft += DRAG_SCROLL_EDGE / 2;
      }
      setDropAt(insertionPoint(moved.clientX));
    };
    const onUp = (released: PointerEvent) => {
      if (released.pointerId !== pointerId) return;
      const at = dragging() === undefined ? undefined : dropAt();
      finish();
      // Permission or formula reference picking can change mid-drag.
      if (at === undefined || props.readonly || props.preserveEditorFocus)
        return;
      const to = target(id, at);
      if (to !== undefined) props.onMove(id, to);
      props.onSelect(id);
    };
    const finish = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', finish);
      setDragging();
      setDropAt();
      endDrag = undefined;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', finish);
    endDrag = finish;
  }

  createEffect(
    on(
      () => props.activeSheetId,
      (id) =>
        buttons.get(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    )
  );

  function navigate(event: KeyboardEvent, id: string) {
    const index = props.sheets.findIndex((sheet) => sheet.id === id);
    if (index < 0) return;
    let next = index;
    if (event.key === 'ArrowLeft')
      next = (index - 1 + props.sheets.length) % props.sheets.length;
    else if (event.key === 'ArrowRight')
      next = (index + 1) % props.sheets.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = props.sheets.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    const sheet = props.sheets[next];
    props.onSelect(sheet.id);
    buttons.get(sheet.id)?.focus({ preventScroll: true });
    buttons
      .get(sheet.id)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  return (
    <div class="flex h-9 min-w-0 max-w-[40%] shrink-0 items-center gap-1 bg-panel px-1 max-sm:max-w-none max-sm:flex-1 touch:h-[48px] lg:max-w-[min(50%,42rem)]">
      <Button
        label="Add sheet"
        size="icon-sm"
        class="h-7 w-7 shrink-0 touch:h-[44px] touch:w-[44px] touch:min-h-[44px] touch:min-w-[44px]"
        disabled={props.readonly || !props.canAdd}
        onClick={props.onAdd}
      >
        <Plus class="size-4" />
      </Button>
      <div
        ref={list}
        role="tablist"
        aria-label="Workbook sheets"
        aria-orientation="horizontal"
        class="flex h-full min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden overscroll-x-contain touch:touch-pan-x"
      >
        <For each={props.sheets}>
          {(sheet, index) => {
            let pendingAction: (() => void) | undefined;
            const defer = (action: (id: string) => void) => {
              if (props.readonly) return;
              pendingAction = () => {
                if (
                  !props.readonly &&
                  props.sheets.some((item) => item.id === sheet.id)
                )
                  action(sheet.id);
              };
            };
            return (
              <ContextMenu
                onOpenChange={(open) => {
                  if (open) props.onSelect(sheet.id);
                }}
              >
                <Tooltip label={sheet.name} class="shrink-0">
                  <ContextMenu.Trigger
                    as="button"
                    ref={(element) => {
                      buttons.set(sheet.id, element);
                      onCleanup(() => {
                        if (buttons.get(sheet.id) === element)
                          buttons.delete(sheet.id);
                      });
                    }}
                    type="button"
                    role="tab"
                    aria-selected={props.activeSheetId === sheet.id}
                    tabIndex={props.activeSheetId === sheet.id ? 0 : -1}
                    class="relative h-full max-w-44 shrink-0 touch:min-w-[44px] truncate border-b-2 px-3 text-[13px] outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
                    classList={{
                      'border-accent bg-accent-bg text-accent':
                        props.activeSheetId === sheet.id,
                      'border-transparent text-ink-muted':
                        props.activeSheetId !== sheet.id,
                      'opacity-60': dragging() === sheet.id,
                    }}
                    onPointerDown={(event) => {
                      if (props.preserveEditorFocus && event.button === 0)
                        event.preventDefault();
                      startDrag(event, sheet.id);
                    }}
                    onMouseDown={(event) => {
                      if (props.preserveEditorFocus && event.button === 0)
                        event.preventDefault();
                    }}
                    onClick={() => props.onSelect(sheet.id)}
                    onDblClick={() => {
                      if (!props.readonly) props.onRename(sheet.id);
                    }}
                    onKeyDown={(event) => navigate(event, sheet.id)}
                  >
                    {sheet.name}
                    <Show when={showDrop(index())}>
                      <span
                        data-sheet-drop-indicator
                        class="absolute inset-y-1 left-0 w-0.5 rounded bg-accent"
                      />
                    </Show>
                    <Show
                      when={
                        index() === props.sheets.length - 1 &&
                        showDrop(props.sheets.length)
                      }
                    >
                      <span
                        data-sheet-drop-indicator
                        class="absolute inset-y-1 right-0 w-0.5 rounded bg-accent"
                      />
                    </Show>
                  </ContextMenu.Trigger>
                </Tooltip>
                <ContextMenu.Portal>
                  <ContextMenuContent
                    class="min-w-44 max-w-[calc(100vw-1rem)]"
                    onCloseAutoFocus={(event) => {
                      const action = pendingAction;
                      pendingAction = undefined;
                      if (!action) return;
                      event.preventDefault();
                      queueMicrotask(action);
                    }}
                  >
                    <MenuItem
                      text="Rename"
                      icon={Pencil}
                      disabled={props.readonly}
                      closeOnSelect
                      onClick={() => defer(props.onRename)}
                    />
                    <MenuItem
                      text="Duplicate"
                      icon={Copy}
                      disabled={props.readonly || !props.canAdd}
                      closeOnSelect
                      onClick={() => defer(props.onDuplicate)}
                    />
                    <ContextMenu.Separator class="my-1 border-t border-edge-muted" />
                    <MenuItem
                      text="Move left"
                      icon={ArrowLeft}
                      disabled={props.readonly || index() <= 0}
                      closeOnSelect
                      onClick={() => defer((id) => move(id, indexOf(id) - 1))}
                    />
                    <MenuItem
                      text="Move right"
                      icon={ArrowRight}
                      disabled={
                        props.readonly || index() >= props.sheets.length - 1
                      }
                      closeOnSelect
                      onClick={() => defer((id) => move(id, indexOf(id) + 1))}
                    />
                    <ContextMenu.Separator class="my-1 border-t border-edge-muted" />
                    <MenuItem
                      text="Delete"
                      icon={Trash}
                      class="text-failure"
                      disabled={props.readonly || props.sheets.length < 2}
                      closeOnSelect
                      onClick={() => defer(props.onDelete)}
                    />
                  </ContextMenuContent>
                </ContextMenu.Portal>
              </ContextMenu>
            );
          }}
        </For>
      </div>
      <SheetActions {...props} />
    </div>
  );
}

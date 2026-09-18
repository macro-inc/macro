import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { ContextMenu } from '@kobalte/core/context-menu';
import CaretDown from '@phosphor/caret-down.svg';
import Copy from '@phosphor/copy.svg';
import Pencil from '@phosphor/pencil-simple.svg';
import Plus from '@phosphor/plus.svg';
import Trash from '@phosphor/trash-simple.svg';
import { Button } from '@ui/components/Button';
import { Dropdown } from '@ui/components/Dropdown';
import { Tooltip } from '@ui/components/Tooltip';
import { createEffect, For, on, onCleanup, Show } from 'solid-js';

export type SpreadsheetSheetTabsProps = {
  sheets: { id: string; name: string }[];
  activeSheetId: string;
  readonly: boolean;
  canAdd: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onAddRows?: () => void;
  addRowsLabel?: string;
};

function SheetActions(props: SpreadsheetSheetTabsProps) {
  const active = () =>
    props.sheets.find((sheet) => sheet.id === props.activeSheetId);
  let pendingAction: (() => void) | undefined;

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
        role="tablist"
        aria-label="Workbook sheets"
        aria-orientation="horizontal"
        class="flex h-full min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden overscroll-x-contain touch:touch-pan-x"
      >
        <For each={props.sheets}>
          {(sheet) => {
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
                    class="h-full max-w-44 shrink-0 touch:min-w-[44px] truncate border-b-2 px-3 text-[13px] outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
                    classList={{
                      'border-accent bg-accent-bg text-accent':
                        props.activeSheetId === sheet.id,
                      'border-transparent text-ink-muted':
                        props.activeSheetId !== sheet.id,
                    }}
                    onClick={() => props.onSelect(sheet.id)}
                    onDblClick={() => {
                      if (!props.readonly) props.onRename(sheet.id);
                    }}
                    onKeyDown={(event) => navigate(event, sheet.id)}
                  >
                    {sheet.name}
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

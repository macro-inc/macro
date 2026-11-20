import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
import { For, type JSX, Show } from 'solid-js';
import { type HeaderMenuAction, headerMenuEntries } from '../core/header-menu';

export type HeaderAction = HeaderMenuAction;
export function SpreadsheetHeaderMenu(props: {
  axis: 'row' | 'column';
  count: number;
  readonly: boolean;
  canChangeStructure?: boolean;
  children: JSX.Element;
  onOpen: () => void;
  onAction: (action: HeaderAction) => void;
  onRestoreFocus: () => void;
}) {
  let pending: HeaderAction | undefined;
  const label = () =>
    `${props.count} ${props.axis}${props.count === 1 ? '' : 's'}`;
  const text = (action: HeaderAction): string => {
    switch (action) {
      case 'copy':
        return 'Copy';
      case 'cut':
        return 'Cut';
      case 'paste':
        return 'Paste';
      case 'paste-values':
        return 'Paste values only';
      case 'insert-before':
        return `Insert ${label()} ${props.axis === 'row' ? 'above' : 'left'}`;
      case 'insert-after':
        return `Insert ${label()} ${props.axis === 'row' ? 'below' : 'right'}`;
      case 'clear-values':
        return `Clear ${label()}`;
      case 'resize':
        return `Resize ${label()}…`;
      case 'autofit':
        return 'Fit to data';
      case 'sort-asc':
        return 'Sort sheet A to Z';
      case 'sort-desc':
        return 'Sort sheet Z to A';
      case 'hide':
        return `Hide ${label()}`;
      case 'unhide':
        return `Unhide all ${props.axis}s`;
      case 'delete':
        return `Delete ${label()}`;
    }
  };
  const item = (text: string, action: HeaderAction, writable = true) => (
    <MenuItem
      class={action === 'delete' ? 'text-failure-ink' : undefined}
      text={text}
      disabled={
        (writable && props.readonly) ||
        ((action.startsWith('insert-') || action === 'delete') &&
          !props.canChangeStructure)
      }
      closeOnSelect
      onClick={() => {
        pending = action;
      }}
    />
  );
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) props.onOpen();
      }}
    >
      <ContextMenu.Trigger
        as="div"
        class="contents"
        onKeyDown={(event: KeyboardEvent) => {
          if (
            event.key === 'ContextMenu' ||
            (event.shiftKey && event.key === 'F10')
          )
            event.stopPropagation();
        }}
      >
        {props.children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenuContent
          class="min-w-56"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const action = pending;
            pending = undefined;
            queueMicrotask(() => {
              props.onRestoreFocus();
              if (action) props.onAction(action);
            });
          }}
        >
          <For each={headerMenuEntries(props.axis)}>
            {(entry) =>
              entry === 'separator' ? (
                <ContextMenu.Separator class="my-1 border-t border-edge-muted" />
              ) : (
                <>
                  {item(text(entry), entry, entry !== 'copy')}
                  <Show
                    when={
                      entry === 'insert-after' &&
                      !props.canChangeStructure &&
                      !props.readonly
                    }
                  >
                    <div class="max-w-64 px-3 py-1 text-xs text-ink-muted">
                      Reconnect to insert or delete rows or columns.
                    </div>
                  </Show>
                </>
              )
            }
          </For>
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}

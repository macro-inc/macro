import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

export type HeaderAction =
  | 'cut'
  | 'copy'
  | 'paste'
  | 'paste-values'
  | 'clear-values'
  | 'insert-before'
  | 'insert-after'
  | 'delete'
  | 'hide'
  | 'unhide'
  | 'resize'
  | 'autofit'
  | 'sort-asc'
  | 'sort-desc';
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
  const item = (text: string, action: HeaderAction, writable = true) => (
    <MenuItem
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
          {item('Cut', 'cut')}
          {item('Copy', 'copy', false)}
          {item('Paste', 'paste')}
          {item('Paste values only', 'paste-values')}
          <ContextMenu.Separator class="my-1 border-t border-edge-muted" />
          {item(
            `Insert ${label()} ${props.axis === 'row' ? 'above' : 'left'}`,
            'insert-before'
          )}
          {item(
            `Insert ${label()} ${props.axis === 'row' ? 'below' : 'right'}`,
            'insert-after'
          )}
          <Show when={!props.canChangeStructure && !props.readonly}>
            <div class="max-w-64 px-3 py-1 text-xs text-ink-muted">
              Insert and delete are available in local workbooks.
            </div>
          </Show>
          {item(`Delete ${label()}`, 'delete')}
          {item(`Clear ${label()}`, 'clear-values')}
          {item(`Hide ${label()}`, 'hide')}
          {item(`Unhide all ${props.axis}s`, 'unhide')}
          {item(`Resize ${label()}…`, 'resize')}
          {item('Fit to data', 'autofit')}
          <Show when={props.axis === 'column'}>
            <ContextMenu.Separator class="my-1 border-t border-edge-muted" />
            {item('Sort sheet A to Z', 'sort-asc')}
            {item('Sort sheet Z to A', 'sort-desc')}
          </Show>
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}

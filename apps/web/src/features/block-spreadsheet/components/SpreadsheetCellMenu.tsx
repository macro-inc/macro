import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import ArrowDown from '@icon/system/regular/arrow-down.svg?component-solid';
import ArrowRight from '@icon/system/regular/arrow-right.svg?component-solid';
import CaretCircleDown from '@icon/system/regular/caret-circle-down.svg?component-solid';
import Chat from '@icon/system/regular/chat-circle.svg?component-solid';
import Clipboard from '@icon/system/regular/clipboard.svg?component-solid';
import Copy from '@icon/system/regular/copy.svg?component-solid';
import Eraser from '@icon/system/regular/eraser.svg?component-solid';
import Scissors from '@icon/system/regular/scissors.svg?component-solid';
import Trash from '@icon/system/regular/trash.svg?component-solid';
import { ContextMenu } from '@kobalte/core/context-menu';
import { type Component, type JSX, Show } from 'solid-js';
import type { SpreadsheetCommand } from '../core/toolbar-types';

export type CellAction =
  | Extract<
      SpreadsheetCommand,
      | 'cut'
      | 'copy'
      | 'paste'
      | 'paste-values'
      | 'clear-values'
      | 'clear-formatting'
      | 'fill-down'
      | 'fill-right'
      | 'dropdown'
    >
  | 'comment';

/** One menu for the virtual grid, anchored at a pointer or keyboard-selected cell. */
export function SpreadsheetCellMenu(props: {
  readonly: boolean;
  canComment?: boolean;
  hasComments?: boolean;
  canFillDown: boolean;
  canFillRight: boolean;
  onAction: (action: CellAction) => void;
  onRestoreFocus: () => void;
  children: (open: (x: number, y: number) => void) => JSX.Element;
}) {
  let trigger!: HTMLSpanElement;
  let pending: CellAction | undefined;
  const item = (
    text: string,
    action: CellAction,
    icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>,
    disabled = props.readonly
  ) => (
    <MenuItem
      text={text}
      icon={icon}
      disabled={disabled}
      closeOnSelect
      onClick={() => {
        pending = action;
      }}
    />
  );
  return (
    <ContextMenu>
      <ContextMenu.Trigger
        as="span"
        ref={trigger}
        class="hidden"
        aria-hidden="true"
      />
      {props.children((x, y) => {
        // Use the primitive's trigger so pointer placement, focus and dismissal
        // behave exactly like the app's other context menus.
        trigger.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          })
        );
      })}
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
          {item('Cut', 'cut', Scissors)}
          {item('Copy', 'copy', Copy, false)}
          {item('Paste', 'paste', Clipboard)}
          {item('Paste values only', 'paste-values', Clipboard)}
          <ContextMenu.Separator class="my-1 border-t border-edge-muted" />
          {item('Clear values', 'clear-values', Trash)}
          {item('Clear formatting', 'clear-formatting', Eraser)}
          <ContextMenu.Separator class="my-1 border-t border-edge-muted" />
          {item(
            'Fill down',
            'fill-down',
            ArrowDown,
            props.readonly || !props.canFillDown
          )}
          {item(
            'Fill right',
            'fill-right',
            ArrowRight,
            props.readonly || !props.canFillRight
          )}
          <ContextMenu.Separator class="my-1 border-t border-edge-muted" />
          {item('Dropdown…', 'dropdown', CaretCircleDown)}
          <Show when={props.hasComments}>
            <ContextMenu.Separator class="my-1 border-t border-edge-muted" />
            {item('Comment', 'comment', Chat, !props.canComment)}
          </Show>
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}

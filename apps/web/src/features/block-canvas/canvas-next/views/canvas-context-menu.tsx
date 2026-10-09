import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import { TOKENS } from '@core/hotkey/tokens';
import { ContextMenu } from '@kobalte/core/context-menu';
import { selectAllCommand } from '@macro-inc/graphics';
import ArrowDown from '@phosphor/arrow-down.svg';
import ArrowLineDown from '@phosphor/arrow-line-down.svg';
import ArrowLineUp from '@phosphor/arrow-line-up.svg';
import ArrowUp from '@phosphor/arrow-up.svg';
import Clipboard from '@phosphor/clipboard.svg';
import Copy from '@phosphor/copy.svg';
import Scissors from '@phosphor/scissors.svg';
import SelectionAll from '@phosphor/selection-all.svg';
import SelectionPlus from '@phosphor/selection-plus.svg';
import SelectionSlash from '@phosphor/selection-slash.svg';
import Stack from '@phosphor/stack.svg';
import Trash from '@phosphor/trash.svg';
import type { CanvasClipboard } from '../clipboard';
import type { CanvasState } from '../primitives/create-canvas-state';

export function CanvasContextMenu(props: {
  state: CanvasState;
  clipboard: CanvasClipboard;
  onClose: () => void;
}) {
  const selected = () => props.state.selection().length > 0;
  return (
    <ContextMenu.Portal>
      <ContextMenuContent
        onCloseAutoFocus={(event) => {
          // The trigger wraps the viewport; return keyboard shortcuts to its
          // focusable graphics surface after the menu closes.
          event.preventDefault();
          props.onClose();
        }}
      >
        <MenuItem
          text="Cut"
          icon={Scissors}
          hotkeyToken={TOKENS.canvas.cut}
          disabled={!selected()}
          onClick={() => void props.clipboard.cut()}
        />
        <MenuItem
          text="Copy"
          icon={Copy}
          hotkeyToken={TOKENS.canvas.copy}
          disabled={!selected()}
          onClick={() => void props.clipboard.copy()}
        />
        <MenuItem
          text="Paste"
          icon={Clipboard}
          hotkeyToken={TOKENS.canvas.paste}
          onClick={() => void props.clipboard.paste()}
        />
        <MenuItem
          text="Duplicate"
          icon={Copy}
          shortcut="cmd+d"
          disabled={!selected()}
          onClick={props.state.duplicate}
        />
        <MenuSeparator />
        <MenuItem
          text="Group"
          icon={SelectionPlus}
          hotkeyToken={TOKENS.canvas.group}
          disabled={!props.state.canGroup()}
          onClick={props.state.group}
        />
        <MenuItem
          text="Ungroup"
          icon={SelectionSlash}
          hotkeyToken={TOKENS.canvas.ungroup}
          disabled={!props.state.canUngroup()}
          onClick={props.state.ungroup}
        />
        <ContextMenu.Sub>
          <SubTrigger text="Arrange" icon={Stack} disabled={!selected()} />
          <ContextMenuContent submenu>
            <MenuItem
              text="Bring to front"
              icon={ArrowLineUp}
              hotkeyToken={TOKENS.canvas.bringToFront}
              onClick={() => props.state.editor.reorderSelection('front')}
            />
            <MenuItem
              text="Bring forward"
              icon={ArrowUp}
              hotkeyToken={TOKENS.canvas.bringForward}
              onClick={() => props.state.editor.reorderSelection('forward')}
            />
            <MenuItem
              text="Send backward"
              icon={ArrowDown}
              hotkeyToken={TOKENS.canvas.sendBackward}
              onClick={() => props.state.editor.reorderSelection('backward')}
            />
            <MenuItem
              text="Send to back"
              icon={ArrowLineDown}
              hotkeyToken={TOKENS.canvas.sendToBack}
              onClick={() => props.state.editor.reorderSelection('back')}
            />
          </ContextMenuContent>
        </ContextMenu.Sub>
        <MenuSeparator />
        <MenuItem
          text="Select all"
          icon={SelectionAll}
          hotkeyToken={TOKENS.canvas.selectAll}
          onClick={() => {
            props.state.chooseTool('select');
            props.state.editor.execute(selectAllCommand, undefined);
          }}
        />
        <MenuItem
          text="Delete"
          icon={Trash}
          hotkeyToken={TOKENS.canvas.delete}
          disabled={!selected()}
          onClick={props.state.editor.deleteSelection}
        />
      </ContextMenuContent>
    </ContextMenu.Portal>
  );
}

import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import { TOKENS } from '@core/hotkey/tokens';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowDown from '@icon/system/regular/arrow-down.svg';
import ArrowLineDown from '@icon/system/regular/arrow-line-down.svg';
import ArrowLineUp from '@icon/system/regular/arrow-line-up.svg';
import ArrowUp from '@icon/system/regular/arrow-up.svg';
import Clipboard from '@icon/system/regular/clipboard.svg';
import Copy from '@icon/system/regular/copy.svg';
import DownloadSimple from '@icon/system/regular/download-simple.svg';
import Scissors from '@icon/system/regular/scissors.svg';
import SelectionAll from '@icon/system/regular/selection-all.svg';
import SelectionPlus from '@icon/system/regular/selection-plus.svg';
import SelectionSlash from '@icon/system/regular/selection-slash.svg';
import Stack from '@icon/system/regular/stack.svg';
import Trash from '@icon/system/regular/trash.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import { selectAllCommand } from '@macro-inc/graphics';
import { Show } from 'solid-js';
import type { CanvasClipboard } from '../clipboard';
import type { CanvasState } from '../primitives/create-canvas-state';

export function CanvasContextMenu(props: {
  state: CanvasState;
  clipboard: CanvasClipboard;
  imageActions?: {
    disabled: boolean;
    onCopy: () => void;
    onSave: () => void;
  };
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
          onClick={() =>
            fireAndForget(props.clipboard.cut(), 'canvas-clipboard')
          }
        />
        <MenuItem
          text="Copy"
          icon={Copy}
          hotkeyToken={TOKENS.canvas.copy}
          disabled={!selected()}
          onClick={() =>
            fireAndForget(props.clipboard.copy(), 'canvas-clipboard')
          }
        />
        <MenuItem
          text="Paste"
          icon={Clipboard}
          hotkeyToken={TOKENS.canvas.paste}
          onClick={() =>
            fireAndForget(props.clipboard.paste(), 'canvas-clipboard')
          }
        />
        <MenuItem
          text="Paste in place"
          icon={Clipboard}
          shortcut="shift+cmd+v"
          onClick={() =>
            fireAndForget(props.clipboard.paste(true), 'canvas-clipboard')
          }
        />
        <MenuItem
          text="Duplicate"
          icon={Copy}
          shortcut="cmd+d"
          disabled={!selected()}
          onClick={props.state.duplicate}
        />
        <MenuSeparator />
        <Show when={props.imageActions}>
          {(actions) => (
            <>
              <MenuItem
                text="Copy image"
                icon={Copy}
                disabled={actions().disabled}
                onClick={() => actions().onCopy()}
              />
              <MenuItem
                text="Save image"
                icon={DownloadSimple}
                disabled={actions().disabled}
                onClick={() => actions().onSave()}
              />
              <MenuSeparator />
            </>
          )}
        </Show>
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

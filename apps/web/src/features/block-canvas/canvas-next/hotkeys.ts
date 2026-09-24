import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import type { HotkeyRegistrationOptions } from '@core/hotkey/types';
import { nudgeCommand, selectAllCommand } from '@macro-inc/graphics';
import { onCleanup } from 'solid-js';
import type { CanvasClipboard } from './clipboard';
import type { CanvasState } from './primitives/create-canvas-state';

export function registerCanvasNextHotkeys(
  scopeId: string,
  state: CanvasState,
  clipboard: CanvasClipboard
) {
  const group = createHotkeyGroup(),
    editor = state.editor;
  const register = (
    hotkey: HotkeyRegistrationOptions['hotkey'],
    description: string,
    action: () => void,
    token?: HotkeyRegistrationOptions['hotkeyToken'],
    proxiedHotkey = false
  ) => {
    group.add(
      registerHotkey({
        scopeId,
        hotkey,
        hotkeyToken: token,
        description,
        proxiedHotkey,
        keyDownHandler: () => {
          action();
          return true;
        },
      })
    );
  };
  register(
    'v',
    'Selection tool',
    () => state.chooseTool('select'),
    TOKENS.canvas.selectTool
  );
  register(
    'r',
    'Rectangle tool',
    () => state.chooseTool('rectangle'),
    TOKENS.canvas.shapeTool
  );
  register('o', 'Ellipse tool', () => state.chooseTool('ellipse'));
  register(
    'h',
    'Hand tool',
    () => state.chooseTool('pan'),
    TOKENS.canvas.handTool
  );
  register(
    'cmd+a',
    'Select all',
    () => {
      state.chooseTool('select');
      editor.execute(selectAllCommand, undefined);
    },
    TOKENS.canvas.selectAll
  );
  register('cmd+d', 'Duplicate selection', state.duplicate);
  register(
    'cmd+c',
    'Copy selection',
    () => {
      void clipboard.copy();
    },
    TOKENS.canvas.copy,
    true
  );
  register(
    'cmd+x',
    'Cut selection',
    () => {
      void clipboard.cut();
    },
    TOKENS.canvas.cut,
    true
  );
  register(
    'cmd+v',
    'Paste shapes',
    () => {
      void clipboard.paste();
    },
    TOKENS.canvas.paste,
    true
  );
  register('cmd+z', 'Undo', editor.undo, TOKENS.canvas.undo);
  register(['shift+cmd+z', 'cmd+y'], 'Redo', editor.redo, TOKENS.canvas.redo);
  register(
    ['delete', 'backspace'],
    'Delete selection',
    editor.deleteSelection,
    TOKENS.canvas.delete
  );
  register('cmd+g', 'Group selection', state.group, TOKENS.canvas.group);
  register(
    'shift+cmd+g',
    'Ungroup selection',
    state.ungroup,
    TOKENS.canvas.ungroup
  );
  register(
    ']',
    'Bring to front',
    () => editor.reorderSelection('front'),
    TOKENS.canvas.bringToFront
  );
  register(
    '[',
    'Send to back',
    () => editor.reorderSelection('back'),
    TOKENS.canvas.sendToBack
  );
  register(
    'opt+]',
    'Bring forward',
    () => editor.reorderSelection('forward'),
    TOKENS.canvas.bringForward
  );
  register(
    'opt+[',
    'Send backward',
    () => editor.reorderSelection('backward'),
    TOKENS.canvas.sendBackward
  );
  for (const [key, x, y] of [
    ['arrowleft', -1, 0],
    ['arrowright', 1, 0],
    ['arrowup', 0, -1],
    ['arrowdown', 0, 1],
  ] as const) {
    register(key, `Nudge ${key.slice(5)}`, () =>
      editor.execute(nudgeCommand, { x, y })
    );
    register(`shift+${key}`, `Nudge ${key.slice(5)} by 10`, () =>
      editor.execute(nudgeCommand, { x: x * 10, y: y * 10 })
    );
  }
  register(
    'escape',
    'Selection tool / cancel',
    () => state.chooseTool('select'),
    TOKENS.canvas.cancel
  );
  // Surface also handles Escape and space-pan to release pointer capture.
  onCleanup(() => group.dispose());
}

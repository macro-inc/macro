import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { createGraphicsEditor } from '@macro-inc/graphics';
import { onCleanup } from 'solid-js';
import { createCanvasClipboard } from './clipboard';
import { createCanvasNextScene } from './core/seed-scene';
import { registerCanvasNextHotkeys } from './hotkeys';
import { createCanvasState } from './primitives/create-canvas-state';
import { CanvasView } from './views/canvas-view';

/** Local composition root. Real document loading/saving is a later checkpoint. */
export default function CanvasNext() {
  const editor = createGraphicsEditor(createCanvasNextScene());
  onCleanup(editor.dispose);
  const state = createCanvasState(editor);
  const clipboard = createCanvasClipboard(editor, state.setNotice);
  const [attachScope, scopeId] = useHotkeyDOMScope('canvas-next');
  registerCanvasNextHotkeys(scopeId, state, clipboard);
  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel label="Canvas Next" />
      </SplitHeaderLeft>
      <CanvasView
        state={state}
        clipboard={clipboard}
        attachScope={attachScope}
      />
    </>
  );
}

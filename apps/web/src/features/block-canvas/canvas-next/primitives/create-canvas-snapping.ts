import type { GraphicsEditor } from '@macro-inc/graphics';
import { batch, createSignal, onCleanup } from 'solid-js';
import { type CanvasSnapMode, canvasSnapUnit } from '../core/snapping';

/** Canvas policy translates the visible grid into the engine's arbitrary unit. */
export function createCanvasSnapping(
  editor: GraphicsEditor,
  cancelPreviews: () => void
) {
  const [snapMode, setMode] = createSignal<CanvasSnapMode>('none');
  const [grid, setGridVisible] = createSignal(true);
  const apply = () => {
    const unit = canvasSnapUnit(snapMode(), editor.getCamera().scale, grid());
    if (unit === editor.getSnapUnit()) return;
    cancelPreviews();
    editor.setSnapUnit(unit);
  };
  apply();
  onCleanup(editor.subscribeCamera(apply));
  return {
    snapMode,
    grid,
    setSnapMode(mode: CanvasSnapMode) {
      batch(() => {
        setMode(mode);
        apply();
      });
    },
    setGrid(visible: boolean) {
      batch(() => {
        setGridVisible(visible);
        apply();
      });
    },
  };
}

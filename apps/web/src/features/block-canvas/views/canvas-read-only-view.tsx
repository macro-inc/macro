import { CanvasDrawingToolbar, CanvasZoomToolbar } from './canvas-toolbars';
import {
  CanvasReadOnlyParts,
  type CanvasReadOnlyViewProps,
  useCanvasReadOnlyView,
} from './shared/canvas-read-only-parts';

function CanvasReadOnlyToolbars() {
  const view = useCanvasReadOnlyView();
  return (
    <>
      <CanvasDrawingToolbar
        readOnly
        tool={view.tool()}
        onTool={(next) => {
          if (next === 'select' || next === 'pan') view.chooseTool(next);
        }}
      />
      <CanvasZoomToolbar
        scale={view.scale()}
        onZoom={view.zoom}
        onFit={view.fit}
        hasSelection={view.hasSelection()}
        onFitSelection={view.fitSelection}
      />
    </>
  );
}

/**
 * The read-only canvas on desktop, as its own page or inside a document, where
 * its controls stay within the embed.
 */
export function CanvasReadOnlyView(props: CanvasReadOnlyViewProps) {
  return (
    <CanvasReadOnlyParts.Root {...props}>
      <CanvasReadOnlyParts.Surface />
      <CanvasReadOnlyParts.Presentation />
      <CanvasReadOnlyToolbars />
    </CanvasReadOnlyParts.Root>
  );
}

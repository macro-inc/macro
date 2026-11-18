import { createSignal } from 'solid-js';
import {
  CanvasReadOnlyParts,
  type CanvasReadOnlyViewProps,
  useCanvasReadOnlyView,
} from '../shared/canvas-read-only-parts';
import { MobileCanvasViewButton } from './canvas-action-islands';
import { MobileCanvasChrome } from './canvas-chrome';
import { MobileCanvasViewSheet } from './canvas-sheets';
import { MobileCanvasReadOnlyToolbar } from './canvas-toolbar';

function MobileCanvasReadOnlyLayout() {
  const view = useCanvasReadOnlyView();
  const [viewOpen, setViewOpen] = createSignal(false);
  return (
    <>
      <CanvasReadOnlyParts.Surface />
      <CanvasReadOnlyParts.Presentation />
      <MobileCanvasChrome frame={view.frameWithin}>
        <div class="flex items-center gap-(--mobile-chrome-gap)">
          <MobileCanvasViewButton
            scale={view.scale()}
            onClick={() => setViewOpen(true)}
          />
          <MobileCanvasReadOnlyToolbar
            tool={view.tool()}
            onTool={view.chooseTool}
          />
        </div>
      </MobileCanvasChrome>
      <MobileCanvasViewSheet
        open={viewOpen()}
        onClose={() => setViewOpen(false)}
        scale={view.scale()}
        onZoom={view.zoom}
        onFit={view.fit}
        hasSelection={view.hasSelection()}
        onFitSelection={view.fitSelection}
      />
    </>
  );
}

/** A canvas opened on a phone or tablet by someone who cannot edit it. */
export function MobileCanvasReadOnlyView(props: CanvasReadOnlyViewProps) {
  return (
    <CanvasReadOnlyParts.Root {...props}>
      <MobileCanvasReadOnlyLayout />
    </CanvasReadOnlyParts.Root>
  );
}

import {
  CanvasReadOnlyParts,
  type CanvasReadOnlyViewProps,
  useCanvasReadOnlyView,
} from '../shared/canvas-read-only-parts';
import { MobileCanvasChrome } from './canvas-chrome';
import { MobileCanvasReadOnlyToolbar } from './canvas-toolbar';

function MobileCanvasReadOnlyBottomChrome() {
  const view = useCanvasReadOnlyView();
  return (
    <MobileCanvasChrome>
      <MobileCanvasReadOnlyToolbar
        tool={view.tool()}
        onTool={view.chooseTool}
      />
    </MobileCanvasChrome>
  );
}

/** A canvas opened on a phone or tablet by someone who cannot edit it. */
export function MobileCanvasReadOnlyView(props: CanvasReadOnlyViewProps) {
  return (
    <CanvasReadOnlyParts.Root {...props}>
      <CanvasReadOnlyParts.Surface />
      <CanvasReadOnlyParts.Presentation />
      <MobileCanvasReadOnlyBottomChrome />
    </CanvasReadOnlyParts.Root>
  );
}

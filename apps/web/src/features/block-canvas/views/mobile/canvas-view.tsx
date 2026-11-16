import { Layer } from '@ui';
import { Show } from 'solid-js';
import { CanvasInspectorSections } from '../shared/canvas-inspector-parts';
import {
  CanvasViewParts,
  type CanvasViewProps,
  useCanvasView,
} from '../shared/canvas-view-parts';
import { MobileCanvasChrome } from './canvas-chrome';
import { MobileCanvasToolbar } from './canvas-toolbar';

/** The selection's inspector, floating below the split header. */
function MobileCanvasInspectorPanel() {
  const { state } = useCanvasView();
  return (
    <Show when={state.selection().length > 0}>
      <Layer depth={2}>
        <aside
          class="absolute right-4 top-16 z-30 flex h-[calc(100%-5rem)] max-h-[calc(100%-5rem)] w-64 max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-xl border border-edge-muted bg-surface shadow-lg"
          aria-label="Canvas inspector"
        >
          <div
            class="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4"
            data-canvas-inspector-scroll
          >
            <CanvasInspectorSections />
          </div>
        </aside>
      </Layer>
    </Show>
  );
}

function MobileCanvasBottomChrome() {
  const view = useCanvasView();
  const { props, state } = view;
  return (
    <MobileCanvasChrome>
      <MobileCanvasToolbar
        tool={state.tool()}
        onTool={view.chooseTool}
        attachOpen={!!props.insert.location()}
        onAttach={props.insert.openFromToolbar}
      />
    </MobileCanvasChrome>
  );
}

/** The editable canvas on phones and tablets. */
export function MobileCanvasView(props: CanvasViewProps) {
  return (
    <CanvasViewParts.Root {...props}>
      <CanvasViewParts.Presentation />
      <CanvasViewParts.InsertMenu />
      <MobileCanvasInspectorPanel />
      <CanvasViewParts.Surface />
      <CanvasViewParts.EmptyState />
      <MobileCanvasBottomChrome />
    </CanvasViewParts.Root>
  );
}

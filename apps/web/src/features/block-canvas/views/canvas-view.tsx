import { useSidePanel } from '@components/app/side-panel';
import { ContextMenu } from '@kobalte/core/context-menu';
import { Layer } from '@ui';
import { Show } from 'solid-js';
import { CanvasContextMenu } from './canvas-context-menu';
import {
  CanvasDrawingToolbar,
  CanvasHistoryControls,
  CanvasViewControls,
} from './canvas-toolbars';
import { CanvasInsertMenu } from './insert-menu';
import { CanvasInspectorSections } from './shared/canvas-inspector-parts';
import {
  CanvasViewParts,
  type CanvasViewProps,
  useCanvasView,
} from './shared/canvas-view-parts';

/** The floating panel on the right: history, zoom, and the selection's inspector. */
function CanvasInspectorPanel() {
  const view = useCanvasView();
  const { state } = view;
  const sidePanel = useSidePanel();
  return (
    <Show when={!sidePanel?.isOpen()}>
      <Layer depth={2}>
        <aside
          class="absolute right-4 top-4 z-30 flex max-h-[calc(100%-2rem)] w-64 max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-xl border border-edge-muted bg-surface shadow-lg"
          style={{
            height:
              state.selection().length > 0 ? 'calc(100% - 2rem)' : undefined,
          }}
          aria-label="Canvas inspector"
        >
          <header class="flex h-10 shrink-0 items-center justify-between px-3">
            <div class="flex items-center gap-1">
              <span class="text-xs font-medium">Canvas</span>
              <CanvasHistoryControls state={state} onFocusCanvas={view.focus} />
            </div>
            <CanvasViewControls
              scale={state.camera().scale}
              grid={state.grid()}
              onGrid={state.setGrid}
              onZoom={view.zoom}
              onFit={view.fit}
              hasSelection={state.selection().length > 0}
              onFitSelection={view.fitSelection}
              snapMode={state.snapMode()}
              onSnapMode={state.setSnapMode}
              snapToObjects={state.snapToObjects()}
              onSnapToObjects={state.setSnapToObjects}
            />
          </header>
          <Show when={state.selection().length > 0}>
            <div
              class="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-edge-muted pb-4 [scrollbar-gutter:stable]"
              data-canvas-inspector-scroll
            >
              <CanvasInspectorSections />
            </div>
          </Show>
        </aside>
      </Layer>
    </Show>
  );
}

/** The scene under a right-click menu of clipboard, grouping and layer actions. */
function CanvasSurfaceWithContextMenu() {
  const view = useCanvasView();
  const { props, state } = view;
  return (
    <ContextMenu>
      <ContextMenu.Trigger
        class="absolute inset-0"
        disabled={!!state.embeds.active() || !!state.text.draft()}
      >
        <CanvasViewParts.Surface />
      </ContextMenu.Trigger>
      <CanvasContextMenu
        state={state}
        clipboard={props.clipboard}
        imageActions={view.imageActions()}
        onClose={view.focus}
      />
    </ContextMenu>
  );
}

/** The Attach menu and its pickers, open wherever the insert state points. */
function CanvasInsert() {
  const { insert, focus } = useCanvasView();
  return (
    <Show when={insert.location()} keyed>
      {(location) => (
        <CanvasInsertMenu
          location={location}
          onSelect={insert.select}
          onFiles={(files) => insert.files(files, location)}
          onUpload={insert.upload}
          onArtifact={insert.artifact}
          onClose={insert.close}
          onRestoreFocus={focus}
        />
      )}
    </Show>
  );
}

function CanvasToolbar() {
  const view = useCanvasView();
  const { props, state } = view;
  return (
    <CanvasDrawingToolbar
      onAttach={props.insert.openFromToolbar}
      attachOpen={!!props.insert.location()}
      tool={state.tool()}
      onTool={view.chooseTool}
    />
  );
}

/** The editable canvas on desktop. */
export function CanvasView(props: CanvasViewProps) {
  return (
    <CanvasViewParts.Root {...props}>
      <CanvasViewParts.Presentation />
      <CanvasInsert />
      <CanvasInspectorPanel />
      <CanvasSurfaceWithContextMenu />
      <CanvasViewParts.EmptyState />
      <CanvasToolbar />
    </CanvasViewParts.Root>
  );
}

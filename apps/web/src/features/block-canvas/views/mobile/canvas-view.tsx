import { makePersistedState } from '@app/lib/persistence';
import { hapticImpact } from '@core/mobile/haptics';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import { selectAllCommand } from '@macro-inc/graphics';
import { createElementSize } from '@solid-primitives/resize-observer';
import { createSignal, type JSX, Show } from 'solid-js';
import {
  CanvasViewParts,
  type CanvasViewProps,
  useCanvasView,
} from '../shared/canvas-view-parts';
import {
  MobileCanvasHistoryIsland,
  MobileCanvasSelectionIsland,
  MobileCanvasViewButton,
} from './canvas-action-islands';
import { MobileCanvasChrome } from './canvas-chrome';
import { MobileCanvasInsertMenu } from './canvas-insert';
import {
  MobileCanvasInspectorPanel,
  MobileCanvasInspectorSheet,
} from './canvas-inspector';
import {
  MobileCanvasActionsSheet,
  MobileCanvasViewSheet,
} from './canvas-sheets';
import {
  type CanvasToolGroupFaces,
  createToolGroupFaces,
  MobileCanvasToolbar,
} from './canvas-toolbar';

// Chrome widths, in px, at which the bar changes shape. One row holds the
// zoom and history islands, the tools, and the selection's actions; the tools
// alone are 373 wide grouped and 511 with every tool listed.
const ONE_ROW_WIDTH = 760;
const ONE_ROW_EVERY_TOOL_WIDTH = 900;
const EVERY_TOOL_WIDTH = 520;

const INSPECTOR_COLLAPSED_KEY = 'canvas-inspector-collapsed';

/**
 * Wraps an action so that the keyboard's focus is back on the canvas once it
 * has run, and the canvas's shortcuts work again at once. Bars and sheets sit
 * outside the canvas and keep the focus otherwise.
 */
const focusingAfter =
  (focus: () => void) =>
  <Args extends unknown[]>(action: (...args: Args) => void) =>
  (...args: Args) => {
    action(...args);
    focus();
  };
/** How near a stroke a long press still picks its shape, in screen pixels. */
const LONG_PRESS_REACH = 10;

/**
 * The canvas's bottom chrome. Zoom and history sit on the left, the tools in
 * the middle, and the selection's actions on the right, in one row wherever
 * that fits: tablets and a phone on its side. An upright phone stacks the
 * tools under the rest.
 */
function MobileCanvasBottomBar(props: {
  groupFaces: CanvasToolGroupFaces;
  styleOpen: boolean;
  onStyle: () => void;
  onView: () => void;
  onMore: () => void;
}) {
  const view = useCanvasView();
  const { state, editor } = view;
  // The bar is portaled out of the canvas, so a press on it misses the
  // canvas's own handlers. It does what a press anywhere on the canvas does
  // first: commit the text being edited and leave an embed.
  const commitEditing = () => {
    state.text.finish();
    if (state.embeds.active()) state.embeds.exit();
  };
  const thenFocus = focusingAfter(view.focus);
  const [bar, setBar] = createSignal<HTMLDivElement>();
  const size = createElementSize(bar);
  const width = () => size.width ?? 0;
  const oneRow = () => width() >= ONE_ROW_WIDTH;
  const everyTool = () =>
    width() >= (oneRow() ? ONE_ROW_EVERY_TOOL_WIDTH : EVERY_TOOL_WIDTH);

  const canvasActions = (): JSX.Element => (
    <div class="flex min-w-0 items-center gap-(--mobile-chrome-gap)">
      <MobileCanvasViewButton
        scale={state.camera().scale}
        onClick={props.onView}
      />
      <MobileCanvasHistoryIsland
        canUndo={state.session().canUndo}
        canRedo={state.session().canRedo}
        onUndo={thenFocus(() => editor.undo())}
        onRedo={thenFocus(() => editor.redo())}
      />
    </div>
  );
  const selectionActions = (): JSX.Element => (
    <Show when={state.selection().length > 0}>
      <MobileCanvasSelectionIsland
        styleOpen={props.styleOpen}
        onStyle={props.onStyle}
        onDuplicate={thenFocus(state.duplicate)}
        onDelete={thenFocus(() => editor.deleteSelection())}
        onMore={props.onMore}
      />
    </Show>
  );
  const tools = (): JSX.Element => (
    <MobileCanvasToolbar
      everyTool={everyTool()}
      groupFaces={props.groupFaces}
      tool={state.tool()}
      onTool={view.chooseTool}
      attachOpen={!!view.props.insert.location()}
      onAttach={view.props.insert.openFromToolbar}
    />
  );

  return (
    <MobileCanvasChrome>
      <div
        ref={setBar}
        class="flex w-full flex-col items-center gap-(--mobile-chrome-gutter)"
        onPointerDown={commitEditing}
      >
        <Show
          when={oneRow()}
          fallback={
            <>
              {/* The selection's actions drop to a row of their own on a
                  phone too narrow to hold them beside zoom and history. */}
              <div class="flex w-full flex-wrap items-center justify-between gap-(--mobile-chrome-gap)">
                {canvasActions()}
                {selectionActions()}
              </div>
              {tools()}
            </>
          }
        >
          {/* Equal side columns keep the tools centred over the dock. */}
          <div class="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-(--mobile-chrome-gap)">
            {canvasActions()}
            {tools()}
            <div class="flex min-w-0 justify-end">{selectionActions()}</div>
          </div>
        </Show>
      </div>
    </MobileCanvasChrome>
  );
}

/** The editable canvas on phones and tablets. */
export function MobileCanvasView(props: CanvasViewProps) {
  return (
    <CanvasViewParts.Root {...props}>
      <MobileCanvasLayout />
    </CanvasViewParts.Root>
  );
}

function MobileCanvasLayout() {
  const view = useCanvasView();
  const { props, state, editor } = view;
  const [viewOpen, setViewOpen] = createSignal(false);
  const [actions, setActions] = createSignal<'more' | 'long-press'>();
  // A phone opens the inspector on request, in a sheet, for the selection it
  // was asked about: it closes when that selection goes. Wider screens keep
  // the inspector beside the canvas until it is collapsed, for the rest of
  // the session.
  const [sheetSelection, setSheetSelection] = createSignal<readonly string[]>();
  const sheetOpen = () =>
    sheetSelection() !== undefined && sheetSelection() === state.selection();
  const [panelCollapsed, setPanelCollapsed] = makePersistedState(
    createSignal(false),
    {
      storages: {
        restore: () =>
          sessionStorage.getItem(INSPECTOR_COLLAPSED_KEY) === 'true',
        write: (collapsed) =>
          sessionStorage.setItem(INSPECTOR_COLLAPSED_KEY, String(collapsed)),
      },
    }
  );
  const groupFaces = createToolGroupFaces(state.tool);
  const hasSelection = () => state.selection().length > 0;
  const styleOpen = () => (isMobile() ? sheetOpen() : !panelCollapsed());
  const toggleStyle = () => {
    if (isMobile())
      setSheetSelection(sheetOpen() ? undefined : state.selection());
    else setPanelCollapsed((collapsed) => !collapsed);
  };

  // A long press belongs to the tools where a still finger means nothing
  // else. It selects what is under the finger, as a right-click does, and
  // opens that selection's actions.
  const longPress = () => {
    if (state.tool() !== 'select' && state.tool() !== 'pan') return;
    return (point: { x: number; y: number }) => {
      hapticImpact('medium');
      view.selectAt(point.x, point.y, LONG_PRESS_REACH);
      setActions('long-press');
    };
  };

  // A sheet takes the keyboard's focus with it, so each way out of the Attach
  // sheets hands it back to the canvas.
  const thenFocus = focusingAfter(view.focus);

  return (
    <>
      <CanvasViewParts.Presentation />
      <MobileCanvasInsertMenu
        location={view.insert.location()}
        onSelect={thenFocus(view.insert.select)}
        onUpload={thenFocus(view.insert.upload)}
        onArtifact={thenFocus(view.insert.artifact)}
        onClose={thenFocus(view.insert.close)}
      />
      <Show when={!isMobile() && hasSelection() && !panelCollapsed()}>
        <MobileCanvasInspectorPanel />
      </Show>
      {/* The browser's own long-press menu and callout have nothing to offer
          on the scene. Text being edited and an embed keep theirs. */}
      <div
        class="absolute inset-0 select-none [-webkit-touch-callout:none]"
        onContextMenu={(event) => {
          if (state.embeds.active() || state.text.draft()) return;
          event.preventDefault();
        }}
      >
        <CanvasViewParts.Surface longPress={longPress} touchHandles />
      </div>
      <CanvasViewParts.EmptyState />
      <MobileCanvasBottomBar
        groupFaces={groupFaces()}
        styleOpen={styleOpen()}
        onStyle={toggleStyle}
        onView={() => setViewOpen(true)}
        onMore={() => setActions('more')}
      />
      <MobileCanvasInspectorSheet
        open={isMobile() && sheetOpen() && hasSelection()}
        onClose={() => setSheetSelection(undefined)}
      />
      <MobileCanvasViewSheet
        open={viewOpen()}
        onClose={() => setViewOpen(false)}
        scale={state.camera().scale}
        onZoom={view.zoom}
        onFit={view.fit}
        hasSelection={hasSelection()}
        onFitSelection={view.fitSelection}
        editing={{
          grid: state.grid(),
          onGrid: state.setGrid,
          snapToObjects: state.snapToObjects(),
          onSnapToObjects: state.setSnapToObjects,
          snapMode: state.snapMode(),
          onSnapMode: state.setSnapMode,
        }}
      />
      <MobileCanvasActionsSheet
        open={actions() !== undefined}
        openedByLongPress={actions() === 'long-press'}
        onClose={() => {
          setActions(undefined);
          view.focus();
        }}
        hasSelection={hasSelection()}
        canGroup={state.canGroup()}
        canUngroup={state.canUngroup()}
        onCut={() => fireAndForget(props.clipboard.cut(), 'canvas-clipboard')}
        onCopy={props.clipboard.copy}
        onPaste={() =>
          fireAndForget(props.clipboard.paste(), 'canvas-clipboard')
        }
        onPasteInPlace={() =>
          fireAndForget(props.clipboard.paste(true), 'canvas-clipboard')
        }
        onDuplicate={state.duplicate}
        onSelectAll={() => {
          state.chooseTool('select');
          editor.execute(selectAllCommand, undefined);
        }}
        onGroup={state.group}
        onUngroup={state.ungroup}
        onReorder={(operation) => editor.reorderSelection(operation)}
        onDelete={() => editor.deleteSelection()}
        image={view.imageActions()}
      />
    </>
  );
}

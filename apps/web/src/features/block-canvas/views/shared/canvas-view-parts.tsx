import { TutorialPill } from '@app/features/video-tutorials';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { createImageActions } from '@core/component/ImageActions';
import { enableCanvasArtifacts } from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import { type DocumentGeometry, screenToWorld } from '@macro-inc/graphics';
import { attachConnectorControls } from '@macro-inc/graphics/browser';
import type { GraphicsPresence } from '@macro-inc/graphics/loro';
import {
  attachPresencePointer,
  GraphicsPresenceOverlay,
} from '@macro-inc/graphics/loro/solid';
import {
  ConnectorView,
  EllipseView,
  GraphicsSurface,
  RectangleView,
  TextView,
} from '@macro-inc/graphics/solid';
import {
  type Component,
  createContext,
  createSignal,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import type { CanvasClipboard } from '../../clipboard';
import type { CanvasEmbedViewProps } from '../../components/embed-view';
import { EraserTrail } from '../../components/eraser-trail';
import { MediaUploadPreviews } from '../../components/media-upload-previews';
import { registerCanvasZoomHotkeys } from '../../hotkeys';
import { createCanvasAssetDrop } from '../../primitives/asset-drop';
import type { CanvasAssetState } from '../../primitives/create-asset-state';
import type {
  CanvasState,
  CanvasTool,
} from '../../primitives/create-canvas-state';
import type { CanvasInsertState } from '../../primitives/create-insert-state';
import { attachTextInput } from '../../primitives/text-input';
import { useCanvasMediaSource } from '../../queries/media';
import { ArtifactPresentation } from '../artifact-presentation';
import { CanvasArtifactView } from '../artifact-view';
import { ConnectorTargets } from '../connector-targets';
import { CanvasDocumentView, CanvasMediaView } from '../embedded-items';
import { CanvasInsertMenu } from '../insert-menu';
import { CanvasTextContent } from '../text-content';
import { TextEditingView } from '../text-editing-view';

export type CanvasViewProps = {
  state: CanvasState;
  presence?: GraphicsPresence;
  fitOnLoad?: boolean;
  scopeId: string;
  embedView: Component<CanvasEmbedViewProps>;
  clipboard: CanvasClipboard;
  assets: CanvasAssetState;
  insert: CanvasInsertState;
  onViewport: (element: HTMLElement) => void;
  onOpenDocument: (geometry: DocumentGeometry) => void;
  attachScope: (element: Element) => void;
};

/** What the parts of one canvas view share: its inputs and its viewport. */
function createCanvasView(props: CanvasViewProps) {
  const state = props.state;
  const editor = state.editor;
  let host: HTMLDivElement | undefined;

  const viewportSize = () => ({
    width: host?.clientWidth ?? 0,
    height: host?.clientHeight ?? 0,
  });
  /** The scene position under a point on the screen. */
  const worldPoint = (clientX: number, clientY: number) => {
    const rect = host?.getBoundingClientRect();
    return screenToWorld(editor.getCamera(), {
      x: clientX - (rect?.left ?? 0),
      y: clientY - (rect?.top ?? 0),
    });
  };
  const focus = () =>
    host
      ?.querySelector<HTMLElement>('[aria-label="Graphics canvas"]')
      ?.focus({ preventScroll: true });
  const fit = () => editor.fitScene(viewportSize());
  const fitSelection = () => editor.fitSelection(viewportSize());
  const zoom = (factor: number) => {
    const { width, height } = viewportSize();
    editor.zoomAt(
      { x: width / 2, y: height / 2 },
      editor.getCamera().scale * factor
    );
  };

  const selectedItem = () =>
    state.selection().length === 1
      ? state.document.items[state.selection()[0]!]
      : undefined;
  const selectedImage = () => {
    const item = selectedItem();
    return item?.type === 'image' ? item : undefined;
  };
  const imageSource = useCanvasMediaSource(
    () => selectedImage()?.geometry.source
  );
  const imageActions = createImageActions({
    src: imageSource.url,
    imageId: () => selectedImage()?.id ?? '',
  });
  const imageActionsDisabled = () =>
    !imageSource.url() || imageActions.isPrefetching() || imageActions.isBusy();

  const artifactsFlag = useFeatureFlag(enableCanvasArtifacts);
  const [presenting, setPresenting] = createSignal<string>();
  // Outlives the inspector, which unmounts whenever nothing is selected.
  const [lockAspectRatio, setLockAspectRatio] = createSignal(false);

  return {
    props,
    state,
    editor,
    setHost(element: HTMLDivElement) {
      host = element;
    },
    host: () => host,
    worldPoint,
    focus,
    fit,
    fitSelection,
    zoom,
    selectedItem,
    selectedImage,
    /** Copy and Save for the one selected image, or undefined without one. */
    imageActions: () =>
      selectedImage()
        ? {
            disabled: imageActionsDisabled(),
            onCopy: () =>
              fireAndForget(
                imageActions.copyToClipboard(),
                'canvas-image-actions'
              ),
            onSave: () =>
              fireAndForget(
                imageActions.downloadImage(),
                'canvas-image-actions'
              ),
          }
        : undefined,
    artifactsEnabled: () => artifactsFlag().enabled,
    presenting,
    setPresenting,
    lockAspectRatio,
    setLockAspectRatio,
    chooseTool(tool: CanvasTool) {
      state.chooseTool(tool);
      focus();
    },
    exitEmbed() {
      state.embeds.exit();
      focus();
    },
    finishText() {
      state.text.finish();
      state.chooseTool('select');
      focus();
    },
    /** Select the item under a screen point, as a context menu's subject. */
    selectAt(clientX: number, clientY: number) {
      if (state.embeds.active() || state.text.draft()) return;
      focus();
      const id = editor.hitTest(worldPoint(clientX, clientY));
      if (id && !state.session().selectedIds.includes(id)) {
        state.chooseTool('select');
        editor.select(id);
      }
    },
  };
}

export type CanvasViewContext = ReturnType<typeof createCanvasView>;

const CanvasViewPartsContext = createContext<CanvasViewContext>();

export function useCanvasView() {
  const view = useContext(CanvasViewPartsContext);
  if (!view) throw new Error('CanvasViewParts must be rendered inside Root');
  return view;
}

/**
 * The frame every canvas view composes inside: it owns the viewport's
 * wiring (hotkey scope, clipboard, text input, drops, presence, first fit)
 * and gives the parts below their shared context.
 */
function Root(props: ParentProps<CanvasViewProps>) {
  const view = createCanvasView(props);
  const { state, editor } = view;
  let root!: HTMLDivElement;

  registerCanvasZoomHotkeys(props.scopeId, state, view.zoom, () =>
    state.selection().length ? view.fitSelection() : view.fit()
  );
  const droppable = createCanvasAssetDrop(
    props.assets,
    view.worldPoint,
    () => !state.embeds.active()
  );

  onMount(() => {
    const host = view.host();
    if (!host) throw new Error('CanvasViewParts.Root needs a Surface');

    const outside = (event: PointerEvent) => {
      if (!state.embeds.active()) return;
      const target = event.target;
      // Portaled editor menus remain owned by the embed until the user returns
      // to this canvas. An outside app click only blurs its hotkey scope.
      if (
        target instanceof Element &&
        root.contains(target) &&
        !target.closest('[data-canvas-embed-active]')
      )
        state.embeds.exit();
    };
    const exitOnEscape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        state.embeds.active() &&
        event.target instanceof Node &&
        root.contains(event.target)
      ) {
        event.preventDefault();
        event.stopPropagation();
        view.exitEmbed();
      }
    };
    root.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', exitOnEscape, true);
    onCleanup(() => {
      root.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', exitOnEscape, true);
    });

    props.attachScope(root);
    props.onViewport(host);
    if (props.presence)
      onCleanup(attachPresencePointer(host, editor, props.presence));
    onCleanup(props.insert.attach(host));
    droppable(host);
    onCleanup(props.clipboard.attach(root));
    onCleanup(attachTextInput(root, state));

    const initialFit = new ResizeObserver(([entry]) => {
      if (!entry?.contentRect.width || !entry.contentRect.height) return;
      if (props.fitOnLoad !== false) view.fit();
      initialFit.disconnect();
    });
    initialFit.observe(host);
    onCleanup(() => initialFit.disconnect());
    view.focus();
  });

  return (
    <CanvasViewPartsContext.Provider value={view}>
      <div
        ref={root}
        class="relative size-full min-h-0 bg-panel text-ink"
        data-canvas-next
      >
        <main class="relative size-full overflow-hidden">{props.children}</main>
      </div>
    </CanvasViewPartsContext.Provider>
  );
}

/** The scene: every item, the text being edited, and other people's presence. */
function Surface() {
  const view = useCanvasView();
  const { props, state, editor } = view;
  return (
    <div
      ref={view.setHost}
      onDragOver={(event) => {
        if (state.embeds.active()) return;
        if (event.dataTransfer?.types.includes('Files')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(event) => {
        if (state.embeds.active()) return;
        if (!event.dataTransfer?.files.length) return;
        event.preventDefault();
        fireAndForget(
          props.assets.files(
            Array.from(event.dataTransfer.files),
            view.worldPoint(event.clientX, event.clientY)
          ),
          'canvas-assets'
        );
      }}
      class="absolute inset-0"
      onContextMenu={(event) => view.selectAt(event.clientX, event.clientY)}
    >
      <GraphicsSurface
        editor={editor}
        class={state.tool() === 'eraser' ? '!cursor-crosshair' : undefined}
        selectionHitArea={
          state.shapes().some((item) => item.type === 'document')
            ? 'shapes'
            : 'bounds'
        }
        attachControls={(surface) => {
          const detachEraser = state.eraser.attach(surface);
          const detachConnector = attachConnectorControls(surface, editor, {
            interaction: state.connector.interaction,
            active: state.isConnectorTool,
            appearance: state.defaults,
            style: state.connector.defaults,
            onCommit: () => state.chooseTool('select'),
          });
          return () => {
            detachEraser();
            detachConnector();
          };
        }}
        hideSelection={
          !!state.embeds.active() ||
          !!state.text.draft() ||
          state.isConnectorTool() ||
          !!state.connector.gesture()
        }
        documentPreview={
          state.inspector.document() ??
          state.eraser.preview() ??
          state.connector.preview()
        }
        renderers={{
          image: (itemProps) => (
            <CanvasMediaView {...itemProps} playing={false} onStop={() => {}} />
          ),
          video: (itemProps) => (
            <CanvasMediaView
              {...itemProps}
              playing={props.assets.playing() === itemProps.item.id}
              onStop={props.assets.stopPlayback}
            />
          ),
          artifact: (itemProps) => (
            <CanvasArtifactView
              {...itemProps}
              active={state.embeds.active() === itemProps.item.id}
              onEnter={() => state.embeds.enter(itemProps.item.id)}
              onExit={view.exitEmbed}
              onPresent={() => view.setPresenting(itemProps.item.id)}
            />
          ),
          document: (itemProps) => (
            <CanvasDocumentView
              {...itemProps}
              embedView={props.embedView}
              active={state.embeds.active() === itemProps.item.id}
              onEnter={() => state.embeds.enter(itemProps.item.id)}
              onExit={view.exitEmbed}
            />
          ),
          connector: (itemProps) => (
            <ConnectorView
              {...itemProps}
              hideLabel={state.text.draft()?.id === itemProps.item.id}
              contentView={CanvasTextContent}
            />
          ),
          rectangle: (itemProps) => (
            <RectangleView
              {...itemProps}
              hideLabel={state.text.draft()?.id === itemProps.item.id}
              contentView={CanvasTextContent}
            />
          ),
          ellipse: (itemProps) => (
            <EllipseView
              {...itemProps}
              hideLabel={state.text.draft()?.id === itemProps.item.id}
              contentView={CanvasTextContent}
            />
          ),
          text: (itemProps) => (
            <Show when={state.text.draft()?.id !== itemProps.item.id}>
              <TextView {...itemProps} contentView={CanvasTextContent} />
            </Show>
          ),
        }}
        input={{
          ignoreTarget: (target) => {
            if (!(target instanceof Element)) return false;
            // An embed being interacted with owns every touch on it.
            if (target.closest('[data-canvas-embed-active]')) return true;
            return (
              !!target.closest(
                '[data-canvas-document],[data-canvas-artifact]'
              ) &&
              !!target.closest('button,a,input,select,textarea,[role="button"]')
            );
          },
          tool: () =>
            state.tool() === 'text' ||
            state.tool() === 'eraser' ||
            state.isConnectorTool()
              ? 'select'
              : (state.tool() as Exclude<
                  CanvasTool,
                  'text' | 'eraser' | 'connector' | 'arrow' | 'line'
                >),
          suspended: () =>
            !!state.embeds.active() ||
            !!state.text.draft() ||
            !!state.connector.gesture(),
          appearance: state.defaults,
          duplicateOnAltDrag: true,
          onShapeCreated: state.shapeCreated,
        }}
        gridColor={
          state.grid()
            ? 'color-mix(in srgb, var(--color-ink-muted) 35%, var(--color-panel))'
            : 'transparent'
        }
      >
        <EraserTrail points={state.eraser.trail()} />
        <MediaUploadPreviews
          previews={props.assets.previews()}
          camera={state.camera()}
        />
        <Show
          when={
            (state.isConnectorTool() || state.connector.gesture()) &&
            state.connector.target()
          }
        >
          {(target) => (
            <ConnectorTargets camera={state.camera()} target={target()} />
          )}
        </Show>
        <Show when={state.text.draft()?.id} keyed>
          {(_id) => (
            <TextEditingView
              text={state.text}
              editor={editor}
              camera={state.camera}
              onFinish={view.finishText}
            />
          )}
        </Show>
      </GraphicsSurface>
      <Show when={props.presence}>
        {(presence) => (
          <GraphicsPresenceOverlay
            editor={editor}
            presence={presence()}
            renderers={{
              rectangle: (itemProps) => (
                <RectangleView {...itemProps} contentView={CanvasTextContent} />
              ),
              ellipse: (itemProps) => (
                <EllipseView {...itemProps} contentView={CanvasTextContent} />
              ),
              connector: (itemProps) => (
                <ConnectorView {...itemProps} contentView={CanvasTextContent} />
              ),
              text: (itemProps) => (
                <TextView {...itemProps} contentView={CanvasTextContent} />
              ),
            }}
          />
        )}
      </Show>
    </div>
  );
}

/** The Attach menu and its pickers, open wherever the insert state points. */
function InsertMenu() {
  const view = useCanvasView();
  const { props } = view;
  return (
    <Show when={props.insert.location()} keyed>
      {(location) => (
        <CanvasInsertMenu
          location={location}
          onClose={props.insert.close}
          onRestoreFocus={view.focus}
          onArtifact={
            view.artifactsEnabled()
              ? () => {
                  props.assets.artifact(location.world);
                  props.insert.close();
                }
              : undefined
          }
          onSelect={(asset, mode) => {
            if (mode === 'media')
              fireAndForget(
                props.assets.media(asset, location.world),
                'canvas-assets'
              );
            else props.assets.document(asset, location.world, 'preview');
            props.insert.close();
          }}
          onFiles={(files) => {
            fireAndForget(
              props.assets.files(files, location.world),
              'canvas-assets'
            );
            props.insert.close();
          }}
        />
      )}
    </Show>
  );
}

/** Artifacts shown full screen, from the one Present was chosen on. */
function Presentation() {
  const view = useCanvasView();
  return (
    <Show when={view.artifactsEnabled() ? view.presenting() : undefined} keyed>
      {(startId) => (
        <ArtifactPresentation
          editor={view.editor}
          startId={startId}
          onExit={() => {
            view.setPresenting(undefined);
            view.focus();
          }}
        />
      )}
    </Show>
  );
}

/** A new board's empty state, until something is on it or a drawing tool is picked. */
function EmptyState() {
  const { state } = useCanvasView();
  // Only the root surface: nothing drawn or placed yet. Stops at the first item.
  const emptyBoard = () => {
    const { items, rootId } = state.snapshot();
    for (const id in items) if (id !== rootId) return false;
    return true;
  };
  return (
    <Show when={emptyBoard() && state.tool() === 'select'}>
      <div class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
        <TutorialPill tutorial="canvas" class="pointer-events-auto" />
      </div>
    </Show>
  );
}

export const CanvasViewParts = {
  Root,
  Surface,
  InsertMenu,
  Presentation,
  EmptyState,
};

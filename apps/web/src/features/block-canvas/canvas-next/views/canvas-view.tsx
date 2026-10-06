import { useSidePanel } from '@components/app/side-panel';
import { ContextMenu } from '@kobalte/core/context-menu';
import {
  alignCommand,
  canLabel,
  type DocumentGeometry,
  distributeCommand,
  screenToWorld,
  styleCommand,
} from '@macro-inc/graphics';
import { attachConnectorControls } from '@macro-inc/graphics/browser';
import {
  ConnectorView,
  EllipseView,
  GraphicsSurface,
  RectangleView,
  TextView,
} from '@macro-inc/graphics/solid';
import { Layer } from '@ui';
import {
  type Component,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { CanvasClipboard } from '../clipboard';
import { ConnectorInspector } from '../components/connector-inspector';
import type { CanvasEmbedViewProps } from '../components/embed-view';
import { EraserTrail } from '../components/eraser-trail';
import { SelectionLayoutInspector } from '../components/selection-layout-inspector';
import { StyleInspector } from '../components/style-inspector';
import { TextInspector } from '../components/text-inspector';
import {
  canEmbedDocument,
  setDocumentDisplayCommand,
} from '../core/document-display';
import {
  selectionLayoutCommand,
  selectionLayoutInfo,
} from '../core/selection-layout';
import { registerCanvasZoomHotkeys } from '../hotkeys';
import { createCanvasAssetDrop } from '../primitives/asset-drop';
import type { CanvasAssetState } from '../primitives/create-asset-state';
import type {
  CanvasState,
  CanvasTool,
} from '../primitives/create-canvas-state';
import { attachTextInput } from '../primitives/text-input';
import { CanvasContextMenu } from './canvas-context-menu';
import {
  CanvasDrawingToolbar,
  CanvasHistoryControls,
  CanvasViewControls,
} from './canvas-toolbars';
import { ConnectorTargets } from './connector-targets';
import { CanvasDocumentView, CanvasMediaView } from './embedded-items';
import { CanvasTextContent } from './text-content';
import { TextEditingView } from './text-editing-view';

export function CanvasView(props: {
  state: CanvasState;
  fitOnLoad?: boolean;
  scopeId: string;
  embedView: Component<CanvasEmbedViewProps>;
  clipboard: CanvasClipboard;
  assets: CanvasAssetState;
  onViewport: (element: HTMLElement) => void;
  onOpenDocument: (geometry: DocumentGeometry) => void;
  attachScope: (element: Element) => void;
}) {
  const state = props.state,
    editor = state.editor;
  const sidePanel = useSidePanel();
  const layout = createMemo(() =>
    selectionLayoutInfo(state.snapshot(), state.selection())
  );
  let root!: HTMLDivElement, host!: HTMLDivElement;
  const [lockAspectRatio, setLockAspectRatio] = createSignal(false);
  const point = (x: number, y: number) => {
    const rect = host.getBoundingClientRect();
    return screenToWorld(editor.getCamera(), {
      x: x - rect.left,
      y: y - rect.top,
    });
  };
  const droppable = createCanvasAssetDrop(
    props.assets,
    point,
    () => !state.embeds.active()
  );
  const selectedItem = () =>
    state.selection().length === 1
      ? state.document.items[state.selection()[0]!]
      : undefined;
  const styleKinds = () =>
    state.shapes().length
      ? state.shapes().map((item) => item.type)
      : [
          state.tool() === 'select' || state.tool() === 'pan'
            ? 'rectangle'
            : state.tool(),
        ];
  const connectorValue = () => {
    const connectors = state
      .shapes()
      .filter((item) => item.type === 'connector');
    if (!connectors.length) return state.connector.defaults();
    const shared = <K extends 'route' | 'startHead' | 'endHead'>(key: K) => {
      const first = connectors[0]!.geometry[key];
      return connectors.every((item) => item.geometry[key] === first)
        ? first
        : undefined;
    };
    return {
      route: shared('route'),
      startHead: shared('startHead'),
      endHead: shared('endHead'),
    };
  };
  const inspectorWidth = () =>
    Math.min(288, Math.max(0, host.clientWidth - 48));
  const fit = () => {
    editor.fitScene({
      width: host.clientWidth - inspectorWidth(),
      height: host.clientHeight,
    });
  };
  const focus = () =>
    host
      .querySelector<HTMLElement>('[aria-label="Graphics canvas"]')
      ?.focus({ preventScroll: true });
  const zoom = (factor: number) =>
    editor.zoomAt(
      {
        x: (host.clientWidth - inspectorWidth()) / 2,
        y: host.clientHeight / 2,
      },
      editor.getCamera().scale * factor
    );
  registerCanvasZoomHotkeys(props.scopeId, state, zoom, fit);
  const exitEmbed = () => {
    state.embeds.exit();
    focus();
  };
  onMount(() => {
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
        exitEmbed();
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
    droppable(host);
    onCleanup(props.clipboard.attach(root));
    onCleanup(attachTextInput(root, state));
    const initialFit = new ResizeObserver(([entry]) => {
      if (!entry?.contentRect.width || !entry.contentRect.height) return;
      if (props.fitOnLoad !== false) fit();
      initialFit.disconnect();
    });
    initialFit.observe(host);
    onCleanup(() => initialFit.disconnect());
    focus();
  });
  const textGeometry = () => {
    const draft = state.text.draft();
    if (draft) return draft.geometry;
    const item = state.document.items[state.selection()[0]!];
    return item?.type === 'text'
      ? item.geometry
      : canLabel(item) && item.geometry.label
        ? item.geometry.label
        : state.text.defaults();
  };
  const labelSelection = () => {
    const item = state.document.items[state.selection()[0]!];
    return (
      state.selection().length === 1 && canLabel(item) && !!item.geometry.label
    );
  };
  const finishText = () => {
    state.text.finish();
    state.chooseTool('select');
    focus();
  };
  return (
    <div
      ref={root}
      class="relative size-full min-h-0 bg-panel text-ink"
      data-canvas-next
    >
      <main class="relative size-full overflow-hidden">
        <Show when={!sidePanel?.isOpen()}>
          <Layer depth={2}>
            <aside
              class="absolute right-4 top-4 z-30 flex max-h-[calc(100%-2rem)] w-64 max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-xl border border-edge-muted bg-surface shadow-lg"
              style={{
                height:
                  state.selection().length > 0
                    ? 'calc(100% - 2rem)'
                    : undefined,
              }}
              aria-label="Canvas inspector"
            >
              <header class="flex h-10 shrink-0 items-center justify-between px-3">
                <div class="flex items-center gap-1">
                  <span class="text-xs font-medium">Canvas</span>
                  <CanvasHistoryControls state={state} onFocusCanvas={focus} />
                </div>
                <CanvasViewControls
                  scale={state.camera().scale}
                  grid={state.grid()}
                  onGrid={state.setGrid}
                  onZoom={zoom}
                  onFit={fit}
                  snapMode={state.snapMode()}
                  onSnapMode={state.setSnapMode}
                />
              </header>
              <Show when={state.selection().length > 0}>
                <div
                  class="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-edge-muted pb-4 [scrollbar-gutter:stable]"
                  data-canvas-inspector-scroll
                >
                  <div class="border-b border-edge-muted px-3 py-3">
                    <h1 class="text-xs font-medium capitalize">
                      {state.selection().length > 1
                        ? `${state.selection().length} selected`
                        : (selectedItem()?.type ??
                          (state.tool() === 'select' || state.tool() === 'pan'
                            ? 'Canvas'
                            : state.tool()))}
                    </h1>
                  </div>

                  <SelectionLayoutInspector
                    snapUnit={state.snapUnit()}
                    lockAspectRatio={lockAspectRatio()}
                    onLockAspectRatio={setLockAspectRatio}
                    onAlign={(alignment) =>
                      editor.execute(alignCommand, alignment)
                    }
                    onDistribute={(axis) =>
                      editor.execute(distributeCommand, axis)
                    }
                    count={layout().count}
                    value={(field) => layout().values[field]}
                    onChange={(field, value) =>
                      editor.execute(selectionLayoutCommand, {
                        field,
                        value,
                        lockAspectRatio: lockAspectRatio(),
                      })
                    }
                    onScrub={(field) => {
                      const locked = lockAspectRatio();
                      const payload = (value: number) => ({
                        field,
                        value,
                        lockAspectRatio: locked,
                      });
                      return state.inspector.begin(
                        (context, value) =>
                          selectionLayoutCommand.apply(context, payload(value))
                            .document,
                        (value) =>
                          editor.execute(selectionLayoutCommand, payload(value))
                      );
                    }}
                    onTransform={(field) =>
                      editor.execute(selectionLayoutCommand, { field })
                    }
                  />
                  <StyleInspector
                    fill={styleKinds().some(
                      (kind) => kind === 'rectangle' || kind === 'ellipse'
                    )}
                    stroke={styleKinds().some((kind) =>
                      [
                        'rectangle',
                        'ellipse',
                        'connector',
                        'arrow',
                        'line',
                        'pencil',
                      ].includes(kind)
                    )}
                    strokePattern={styleKinds().some((kind) =>
                      [
                        'rectangle',
                        'ellipse',
                        'connector',
                        'arrow',
                        'line',
                      ].includes(kind)
                    )}
                    corners={styleKinds().includes('rectangle')}
                    text={styleKinds().every((kind) => kind === 'text')}
                    canvasColors={state.canvasColors()}
                    value={state.appearanceValue}
                    onChange={state.style}
                    onScrub={(key) => {
                      const patch = (value: number) => ({
                        [key]: key === 'opacity' ? value / 100 : value,
                      });
                      return state.inspector.begin(
                        (context, value) =>
                          styleCommand.apply(context, patch(value)).document,
                        (value) => state.style(patch(value))
                      );
                    }}
                  />
                  <Show
                    when={
                      state.isConnectorTool() ||
                      state.shapes().some((item) => item.type === 'connector')
                    }
                  >
                    <ConnectorInspector
                      value={connectorValue()}
                      onChange={state.connector.style}
                    />
                  </Show>
                  <Show
                    when={
                      state.tool() === 'text' ||
                      state.text.draft() ||
                      state.shapes().some((item) => item.type === 'text') ||
                      labelSelection()
                    }
                  >
                    <TextInspector
                      label={
                        state.text.isLabel() ||
                        (!state.text.draft() && labelSelection())
                      }
                      geometry={textGeometry()}
                      onChange={state.text.typography}
                      onScrub={() => state.text.scrubFontSize(state.inspector)}
                    />
                  </Show>
                  <Show when={selectedItem()?.type === 'video'}>
                    <button
                      type="button"
                      class="m-3 rounded border border-edge-muted p-2 text-xs hover:bg-hover"
                      onClick={() =>
                        props.assets.togglePlayback(state.selection()[0]!)
                      }
                    >
                      {props.assets.playing() === state.selection()[0]
                        ? 'Pause video'
                        : 'Play video'}
                    </button>
                  </Show>
                  <Show when={selectedItem()?.type === 'document'}>
                    <button
                      type="button"
                      class="m-3 rounded border border-edge-muted p-2 text-xs hover:bg-hover"
                      onClick={() => {
                        const item = selectedItem();
                        if (item?.type === 'document')
                          props.onOpenDocument(item.geometry);
                      }}
                    >
                      Open document
                    </button>
                    <Show
                      when={(() => {
                        const item = selectedItem();
                        return (
                          item?.type === 'document' &&
                          canEmbedDocument(item.geometry.fileType)
                        );
                      })()}
                    >
                      <button
                        type="button"
                        class="mx-3 mb-3 rounded border border-edge-muted p-2 text-xs hover:bg-hover"
                        onClick={() => {
                          const item = selectedItem();
                          if (item?.type !== 'document') return;
                          state.embeds.exit();
                          editor.execute(setDocumentDisplayCommand, {
                            id: item.id,
                            display:
                              item.geometry.display === 'embed'
                                ? 'preview'
                                : 'embed',
                          });
                        }}
                      >
                        {(() => {
                          const item = selectedItem();
                          return item?.type === 'document' &&
                            item.geometry.display === 'embed'
                            ? 'Use preview card'
                            : 'Use full embed';
                        })()}
                      </button>
                    </Show>
                  </Show>
                </div>
              </Show>
            </aside>
          </Layer>
        </Show>
        <ContextMenu>
          <ContextMenu.Trigger
            class="absolute inset-0"
            disabled={!!state.embeds.active() || !!state.text.draft()}
          >
            <div
              ref={host}
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
                void props.assets.files(
                  Array.from(event.dataTransfer.files),
                  point(event.clientX, event.clientY)
                );
              }}
              class="absolute inset-0"
              onContextMenu={(event) => {
                if (state.embeds.active() || state.text.draft()) return;
                focus();
                const rect = host.getBoundingClientRect();
                const id = editor.hitTest(
                  screenToWorld(editor.getCamera(), {
                    x: event.clientX - rect.left,
                    y: event.clientY - rect.top,
                  })
                );
                if (id && !state.session().selectedIds.includes(id)) {
                  state.chooseTool('select');
                  editor.select(id);
                }
              }}
            >
              <GraphicsSurface
                editor={editor}
                class={
                  state.tool() === 'eraser' ? '!cursor-crosshair' : undefined
                }
                selectionHitArea={
                  state.shapes().some((item) => item.type === 'document')
                    ? 'shapes'
                    : 'bounds'
                }
                attachControls={(surface) => {
                  const detachEraser = state.eraser.attach(surface);
                  const detachConnector = attachConnectorControls(
                    surface,
                    editor,
                    {
                      interaction: state.connector.interaction,
                      active: state.isConnectorTool,
                      appearance: state.defaults,
                      style: state.connector.defaults,
                      onCommit: () => state.chooseTool('select'),
                    }
                  );
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
                    <CanvasMediaView
                      {...itemProps}
                      playing={false}
                      onStop={() => {}}
                    />
                  ),
                  video: (itemProps) => (
                    <CanvasMediaView
                      {...itemProps}
                      playing={props.assets.playing() === itemProps.item.id}
                      onStop={props.assets.stopPlayback}
                    />
                  ),
                  document: (itemProps) => (
                    <CanvasDocumentView
                      {...itemProps}
                      embedView={props.embedView}
                      active={state.embeds.active() === itemProps.item.id}
                      onEnter={() => state.embeds.enter(itemProps.item.id)}
                      onEmbed={() =>
                        editor.execute(setDocumentDisplayCommand, {
                          id: itemProps.item.id,
                          display: 'embed',
                        })
                      }
                      onExit={exitEmbed}
                    />
                  ),
                  connector: (props) => (
                    <ConnectorView
                      {...props}
                      hideLabel={state.text.draft()?.id === props.item.id}
                      contentView={CanvasTextContent}
                    />
                  ),
                  rectangle: (props) => (
                    <RectangleView
                      {...props}
                      hideLabel={state.text.draft()?.id === props.item.id}
                      contentView={CanvasTextContent}
                    />
                  ),
                  ellipse: (props) => (
                    <EllipseView
                      {...props}
                      hideLabel={state.text.draft()?.id === props.item.id}
                      contentView={CanvasTextContent}
                    />
                  ),
                  text: (props) => (
                    <Show when={state.text.draft()?.id !== props.item.id}>
                      <TextView {...props} contentView={CanvasTextContent} />
                    </Show>
                  ),
                }}
                input={{
                  ignoreTarget: (target) =>
                    target instanceof Element &&
                    !!target.closest('[data-canvas-document]') &&
                    !!target.closest(
                      'button,a,input,select,textarea,[role="button"]'
                    ),
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
                <Show
                  when={
                    (state.isConnectorTool() || state.connector.gesture()) &&
                    state.connector.target()
                  }
                >
                  {(target) => (
                    <ConnectorTargets
                      camera={state.camera()}
                      target={target()}
                    />
                  )}
                </Show>
                <Show when={state.text.draft()?.id} keyed>
                  {(_id) => (
                    <TextEditingView
                      text={state.text}
                      editor={editor}
                      camera={state.camera}
                      onFinish={finishText}
                    />
                  )}
                </Show>
              </GraphicsSurface>
            </div>
          </ContextMenu.Trigger>
          <CanvasContextMenu
            state={state}
            clipboard={props.clipboard}
            onClose={focus}
          />
        </ContextMenu>
        <CanvasDrawingToolbar
          tool={state.tool()}
          onTool={(tool) => {
            state.chooseTool(tool);
            focus();
          }}
        />
      </main>
    </div>
  );
}

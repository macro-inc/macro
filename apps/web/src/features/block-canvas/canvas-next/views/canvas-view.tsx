import { ContextMenu } from '@kobalte/core/context-menu';
import {
  alignCommand,
  canLabel,
  type DocumentGeometry,
  distributeCommand,
  screenToWorld,
} from '@macro-inc/graphics';
import { attachConnectorControls } from '@macro-inc/graphics/browser';
import {
  EllipseView,
  GraphicsSurface,
  RectangleView,
  TextView,
} from '@macro-inc/graphics/solid';
import { Card } from '@ui';
import {
  type Component,
  createSignal,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import type { CanvasClipboard } from '../clipboard';
import { CanvasArrangeControls } from '../components/arrange-controls';
import { ConnectorInspector } from '../components/connector-inspector';
import type { CanvasEmbedViewProps } from '../components/embed-view';
import { CanvasLayers } from '../components/layers';
import { StyleInspector } from '../components/style-inspector';
import { TextInspector } from '../components/text-inspector';
import {
  canEmbedDocument,
  setDocumentDisplayCommand,
} from '../core/document-display';
import { createCanvasNextScene } from '../core/seed-scene';
import { createCanvasAssetDrop } from '../primitives/asset-drop';
import type { CanvasAssetState } from '../primitives/create-asset-state';
import type {
  CanvasState,
  CanvasTool,
} from '../primitives/create-canvas-state';
import { attachTextInput } from '../primitives/text-input';
import { CanvasAssetPicker } from './asset-picker';
import { CanvasContextMenu } from './canvas-context-menu';
import {
  CanvasDrawingToolbar,
  CanvasNavigationToolbar,
} from './canvas-toolbars';
import { ConnectorTargets } from './connector-targets';
import { CanvasDocumentView, CanvasMediaView } from './embedded-items';
import { CanvasTextContent } from './text-content';
import { TextEditingView } from './text-editing-view';

export function CanvasView(props: {
  state: CanvasState;
  embedView: Component<CanvasEmbedViewProps>;
  clipboard: CanvasClipboard;
  assets: CanvasAssetState;
  onViewport: (element: HTMLElement) => void;
  onOpenDocument: (geometry: DocumentGeometry) => void;
  attachScope: (element: Element) => void;
}) {
  const state = props.state,
    editor = state.editor;
  let root!: HTMLDivElement, host!: HTMLDivElement;
  const [assetPicker, setAssetPicker] = createSignal<
    'media' | 'document' | 'embed'
  >();
  const point = (x: number, y: number) => {
    const rect = host.getBoundingClientRect();
    return screenToWorld(editor.getCamera(), {
      x: x - rect.left,
      y: y - rect.top,
    });
  };
  const center = () =>
    screenToWorld(editor.getCamera(), {
      x: host.clientWidth / 2,
      y: host.clientHeight / 2,
    });
  const droppable = createCanvasAssetDrop(
    props.assets,
    point,
    () => !state.embeds.active()
  );
  const selectedItem = () =>
    state.selection().length === 1
      ? state.document.items[state.selection()[0]!]
      : undefined;
  const [inspector, setInspector] = createSignal(true);
  const [layers, setLayers] = createSignal(false);
  const fit = () =>
    editor.fitScene({
      width: host.clientWidth,
      height: host.clientHeight,
    });
  const focus = () =>
    host
      .querySelector<HTMLElement>('[aria-label="Graphics canvas"]')
      ?.focus({ preventScroll: true });
  const zoom = (factor: number) =>
    editor.zoomAt(
      { x: host.clientWidth / 2, y: host.clientHeight / 2 },
      editor.getCamera().scale * factor
    );
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
      fit();
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
    return state.selection().length === 1 && canLabel(item);
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
        <Show when={inspector()}>
          <Card
            depth={2}
            variant="filled"
            class="absolute left-4 top-20 z-10 max-h-[calc(100%-10rem)] w-56 overflow-y-auto shadow-lg"
            role="complementary"
            aria-label="Canvas inspector"
          >
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
              />
            </Show>
            <Show
              when={
                state.isConnectorTool() ||
                state.shapes().some((item) => item.type === 'connector')
              }
            >
              <ConnectorInspector
                value={
                  state.shapes().find((item) => item.type === 'connector')
                    ?.geometry ?? state.connector.defaults()
                }
                onChange={state.connector.style}
              />
            </Show>
            <Show when={selectedItem()?.type === 'video'}>
              <button
                type="button"
                class="m-3 rounded bg-accent-bg p-2 text-xs text-accent"
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
                class="m-3 rounded bg-accent-bg p-2 text-xs text-accent"
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
                        item.geometry.display === 'embed' ? 'preview' : 'embed',
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
            <StyleInspector
              count={state.shapes().length}
              value={state.appearanceValue}
              onChange={state.style}
            />
            <Show when={state.selection().length > 0}>
              <CanvasArrangeControls
                count={state.selection().length}
                canGroup={state.canGroup()}
                canUngroup={state.canUngroup()}
                onAlign={(alignment) => editor.execute(alignCommand, alignment)}
                onDistribute={(axis) => editor.execute(distributeCommand, axis)}
                onGroup={state.group}
                onUngroup={state.ungroup}
                onLayer={editor.reorderSelection}
              />
            </Show>
          </Card>
        </Show>
        <Show when={layers()}>
          <Card
            depth={2}
            variant="filled"
            class="absolute right-4 top-20 z-10 max-h-[calc(100%-10rem)] w-56 overflow-y-auto shadow-lg"
            role="complementary"
            aria-label="Canvas layers"
          >
            <CanvasLayers
              document={state.document}
              selected={state.session().selectedIds}
              onSelect={(id, additive) => {
                state.chooseTool('select');
                if (additive) editor.toggleSelection(id);
                else editor.select(id);
              }}
            />
          </Card>
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
                selectionHitArea={
                  state.shapes().some((item) => item.type === 'document')
                    ? 'shapes'
                    : 'bounds'
                }
                attachControls={(surface) =>
                  attachConnectorControls(surface, editor, {
                    interaction: state.connector.interaction,
                    active: state.isConnectorTool,
                    appearance: state.defaults,
                    style: state.connector.defaults,
                    onCommit: () => state.chooseTool('select'),
                  })
                }
                hideSelection={
                  !!state.embeds.active() ||
                  !!state.text.draft() ||
                  state.isConnectorTool() ||
                  !!state.connector.gesture()
                }
                documentPreview={state.connector.preview()}
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
                    state.tool() === 'text' || state.isConnectorTool()
                      ? 'select'
                      : (state.tool() as Exclude<
                          CanvasTool,
                          'text' | 'connector' | 'arrow' | 'line'
                        >),
                  suspended: () =>
                    !!state.embeds.active() ||
                    !!state.text.draft() ||
                    !!state.connector.gesture(),
                  appearance: state.defaults,
                  duplicateOnAltDrag: true,
                  onShapeCreated: state.shapeCreated,
                }}
                gridColor="var(--color-edge-muted)"
              >
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
          onInsert={(kind) => {
            state.chooseTool('select');
            setAssetPicker(kind);
          }}
        />
        <Show when={assetPicker()}>
          {(mode) => (
            <Suspense
              fallback={
                <div class="absolute right-4 top-4 rounded bg-panel p-4">
                  Loading files…
                </div>
              }
            >
              <CanvasAssetPicker
                mode={mode()}
                onClose={() => setAssetPicker(undefined)}
                onFiles={(files) => {
                  void props.assets.files(files, center());
                  setAssetPicker(undefined);
                  focus();
                }}
                onSelect={(asset) => {
                  if (mode() === 'media')
                    void props.assets.media(asset, center());
                  else
                    props.assets.document(
                      asset,
                      center(),
                      mode() === 'embed' ? 'embed' : 'preview'
                    );
                  setAssetPicker(undefined);
                  focus();
                }}
              />
            </Suspense>
          )}
        </Show>
        <CanvasNavigationToolbar
          state={state}
          onZoom={zoom}
          onFit={fit}
          onFocusCanvas={focus}
          onReset={() => {
            state.text.cancel();
            props.assets.cancelPending();
            editor.resetDocument(createCanvasNextScene());
            state.chooseTool('select');
            fit();
            state.setNotice('Fresh demo scene');
          }}
          inspector={inspector()}
          onInspector={() => setInspector((value) => !value)}
          layers={layers()}
          onLayers={() => setLayers((value) => !value)}
        />
        <span
          role="status"
          class="pointer-events-none absolute bottom-5 right-4 max-w-[calc(100%-32rem)] truncate text-xs text-ink-muted"
        >
          {state.notice()}
        </span>
      </main>
    </div>
  );
}

import { DocumentPreviewContent } from '@core/component/DocumentPreview';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { GraphicsEditor } from '@macro-inc/graphics';
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
  createContext,
  createSignal,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import { ArtifactPresentation } from '../artifact-presentation';
import { CanvasArtifactView } from '../artifact-view';
import { CanvasMediaView } from '../embedded-items';
import { CanvasTextContent } from '../text-content';
import { createCanvasFraming } from './canvas-framing';

export type CanvasReadOnlyViewProps = {
  editor: GraphicsEditor;
  presence?: GraphicsPresence;
  fitOnLoad?: boolean;
};

export type CanvasReadOnlyTool = 'select' | 'pan';

/** What the parts of one read-only canvas view share. */
function createCanvasReadOnlyView(props: CanvasReadOnlyViewProps) {
  const editor = props.editor;
  let host: HTMLDivElement | undefined;
  const [tool, setTool] = createSignal<CanvasReadOnlyTool>('select');
  const [activeArtifact, setActiveArtifact] = createSignal<string>();
  const [presenting, setPresenting] = createSignal<string>();
  const [scale, setScale] = createSignal(editor.getCamera().scale);
  const [hasSelection, setHasSelection] = createSignal(
    editor.getSession().selectedIds.length > 0
  );
  const unsubscribeSession = editor.subscribeSession((session) =>
    setHasSelection(session.selectedIds.length > 0)
  );
  onCleanup(unsubscribeSession);
  const unsubscribeCamera = editor.subscribeCamera((camera) =>
    setScale(camera.scale)
  );
  onCleanup(unsubscribeCamera);

  const framing = createCanvasFraming(editor, () => host);
  const focus = () =>
    host
      ?.querySelector<HTMLElement>('[aria-label="Graphics canvas"]')
      ?.focus({ preventScroll: true });
  return {
    props,
    editor,
    setHost(element: HTMLDivElement) {
      host = element;
      framing.watchPresses(element);
    },
    host: () => host,
    tool,
    chooseTool(next: CanvasReadOnlyTool) {
      setTool(next);
      focus();
    },
    scale,
    hasSelection,
    focus,
    zoom(factor: number) {
      editor.zoomAt(framing.centre(), editor.getCamera().scale * factor);
    },
    fit: framing.fit,
    fitSelection: framing.fitSelection,
    frameWithin: framing.frameWithin,
    activeArtifact,
    setActiveArtifact,
    presenting,
    setPresenting,
  };
}

type CanvasReadOnlyViewContext = ReturnType<typeof createCanvasReadOnlyView>;

const CanvasReadOnlyPartsContext = createContext<CanvasReadOnlyViewContext>();

export function useCanvasReadOnlyView() {
  const view = useContext(CanvasReadOnlyPartsContext);
  if (!view)
    throw new Error('CanvasReadOnlyParts must be rendered inside Root');
  return view;
}

/**
 * The frame of a canvas someone can look around but not change: navigation
 * and selection, with no editing handlers or embedded editors.
 */
function Root(props: ParentProps<CanvasReadOnlyViewProps>) {
  const view = createCanvasReadOnlyView(props);
  onMount(() => {
    const host = view.host();
    if (!host) return;
    if (props.presence)
      onCleanup(attachPresencePointer(host, props.editor, props.presence));
    const observer = new ResizeObserver(([entry]) => {
      if (!entry?.contentRect.width || !entry.contentRect.height) return;
      if (props.fitOnLoad !== false) view.fit();
      observer.disconnect();
    });
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  });
  return (
    <CanvasReadOnlyPartsContext.Provider value={view}>
      <div
        ref={view.setHost}
        class="relative size-full min-h-0"
        on:keydown={(event) => {
          if (
            !(event.target instanceof HTMLElement) ||
            event.target.getAttribute('aria-label') !== 'Graphics canvas'
          )
            return;
          event.stopPropagation();
          if (event.altKey) return;
          if (event.ctrlKey || event.metaKey) {
            if (event.key === '=' || event.key === '+') view.zoom(1.2);
            else if (event.key === '-') view.zoom(1 / 1.2);
            else return;
            event.preventDefault();
            return;
          }
          if (event.shiftKey) return;
          if (event.key === '.') {
            if (view.hasSelection()) view.fitSelection();
            else view.fit();
          } else if (event.key.toLowerCase() === 'v') view.chooseTool('select');
          else if (event.key.toLowerCase() === 'h') view.chooseTool('pan');
          else return;
          event.preventDefault();
        }}
      >
        {props.children}
      </div>
    </CanvasReadOnlyPartsContext.Provider>
  );
}

/** The scene and other people's presence. */
function Surface(surfaceProps: {
  /**
   * Leave one finger and the plain wheel to the page while this says so: for
   * a canvas inside a scrolling document.
   */
  yieldToPage?: () => boolean;
}) {
  const view = useCanvasReadOnlyView();
  const { props } = view;
  return (
    <>
      <GraphicsSurface
        editor={props.editor}
        input={{
          editing: false,
          tool: view.tool,
          yieldToPage: () => surfaceProps.yieldToPage?.() ?? false,
          ignoreTarget: (target) =>
            target instanceof Element &&
            !!target.closest('[data-graphics-item]') &&
            !!target.closest('button,a,input,select,textarea,[role="button"]'),
        }}
        gridColor="transparent"
        renderers={{
          artifact: (p) => (
            <CanvasArtifactView
              {...p}
              active={view.activeArtifact() === p.item.id}
              onEnter={() => view.setActiveArtifact(p.item.id)}
              onExit={() => view.setActiveArtifact(undefined)}
              onPresent={() => view.setPresenting(p.item.id)}
            />
          ),
          connector: (p) => (
            <ConnectorView {...p} contentView={CanvasTextContent} />
          ),
          rectangle: (p) => (
            <RectangleView {...p} contentView={CanvasTextContent} />
          ),
          ellipse: (p) => (
            <EllipseView {...p} contentView={CanvasTextContent} />
          ),
          text: (p) => <TextView {...p} contentView={CanvasTextContent} />,
          image: (p) => (
            <CanvasMediaView {...p} playing={false} onStop={() => {}} />
          ),
          video: (p) => (
            <CanvasMediaView {...p} playing={false} onStop={() => {}} />
          ),
          document: (p) => (
            <DocumentPreviewContent
              documentInfo={{
                id: p.item.geometry.documentId,
                type: fileTypeToBlockName(p.item.geometry.fileType),
                params: {},
                isOpenable: true,
              }}
            />
          ),
        }}
      />
      <Show when={props.presence}>
        {(presence) => (
          <GraphicsPresenceOverlay
            editor={props.editor}
            presence={presence()}
          />
        )}
      </Show>
    </>
  );
}

/** Artifacts shown full screen, from the one Present was chosen on. */
function Presentation() {
  const view = useCanvasReadOnlyView();
  return (
    <Show when={view.presenting()} keyed>
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

export const CanvasReadOnlyParts = { Root, Surface, Presentation };

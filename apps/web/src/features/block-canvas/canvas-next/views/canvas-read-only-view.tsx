import { DocumentPreviewContent } from '@core/component/DocumentPreview';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { GraphicsEditor } from '@macro-inc/graphics';
import {
  ConnectorView,
  EllipseView,
  GraphicsSurface,
  RectangleView,
  TextView,
} from '@macro-inc/graphics/solid';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { CanvasDrawingToolbar, CanvasZoomToolbar } from './canvas-toolbars';
import { CanvasMediaView } from './embedded-items';
import { CanvasTextContent } from './text-content';

/** Viewers get navigation without mounting editing handlers or embedded editors. */
export function CanvasReadOnlyView(props: {
  editor: GraphicsEditor;
  fitOnLoad?: boolean;
}) {
  const [tool, setTool] = createSignal<'select' | 'pan'>('select');
  const [scale, setScale] = createSignal(props.editor.getCamera().scale);
  onCleanup(props.editor.subscribeCamera((camera) => setScale(camera.scale)));
  let host!: HTMLDivElement;
  const zoom = (factor: number) =>
    props.editor.zoomAt(
      { x: host.clientWidth / 2, y: host.clientHeight / 2 },
      props.editor.getCamera().scale * factor
    );
  const focus = () =>
    host
      .querySelector<HTMLElement>('[aria-label="Graphics canvas"]')
      ?.focus({ preventScroll: true });
  const fit = () =>
    props.editor.fitScene({
      width: host.clientWidth,
      height: host.clientHeight,
    });
  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (!entry?.contentRect.width || !entry.contentRect.height) return;
      if (props.fitOnLoad !== false) fit();
      observer.disconnect();
    });
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  });
  return (
    <div
      ref={host}
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
          if (event.key === '=' || event.key === '+') zoom(1.2);
          else if (event.key === '-') zoom(1 / 1.2);
          else return;
          event.preventDefault();
          return;
        }
        if (event.shiftKey) return;
        if (event.key === '.') fit();
        else if (event.key.toLowerCase() === 'v') setTool('select');
        else if (event.key.toLowerCase() === 'h') setTool('pan');
        else return;
        event.preventDefault();
      }}
    >
      <GraphicsSurface
        editor={props.editor}
        input={{ editing: false, tool }}
        gridColor="transparent"
        renderers={{
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
      <CanvasDrawingToolbar
        readOnly
        tool={tool()}
        onTool={(next) => {
          if (next !== 'select' && next !== 'pan') return;
          setTool(next);
          focus();
        }}
      />
      <CanvasZoomToolbar scale={scale()} onZoom={zoom} onFit={fit} />
    </div>
  );
}

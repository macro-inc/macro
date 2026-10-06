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
import { onCleanup, onMount } from 'solid-js';
import { CanvasMediaView } from './embedded-items';
import { CanvasTextContent } from './text-content';

/** Viewers get navigation without mounting editing handlers or embedded editors. */
export function CanvasReadOnlyView(props: {
  editor: GraphicsEditor;
  fitOnLoad?: boolean;
}) {
  let host!: HTMLDivElement;
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
    <div ref={host} class="relative size-full min-h-0">
      <GraphicsSurface
        editor={props.editor}
        input={{ editing: false, tool: () => 'pan' }}
        hideSelection
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
                name: p.item.geometry.name,
                type: fileTypeToBlockName(p.item.geometry.fileType),
                params: {},
                isOpenable: true,
              }}
            />
          ),
        }}
      />
      <button
        type="button"
        class="absolute bottom-4 left-4 rounded border border-edge-muted bg-panel px-3 py-2 text-sm"
        onClick={fit}
      >
        Fit canvas
      </button>
    </div>
  );
}

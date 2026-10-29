import '../../../index.css';
import '@fontsource-variable/inter';
import '@fontsource-variable/roboto-mono';
import '@fontsource-variable/playfair-display';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { initializeLexical } from '@core/component/LexicalMarkdown/init';
import {
  type Bounds,
  canLabel,
  createGraphicsEditor,
  fitTextLayout,
  type GraphicsDocument,
  shapeLabelLayout,
  type TextFitRequest,
  type TextFitResult,
} from '@macro-inc/graphics';
import {
  ConnectorView,
  EllipseView,
  GraphicsSurface,
  RectangleView,
  TextView,
} from '@macro-inc/graphics/solid';
import { render } from 'solid-js/web';
import { CanvasTextContent, createCanvasTextMeasurer } from './text-content';

initializeLexical();
const fontsReady = Promise.all(
  ['Inter Variable', 'Roboto Mono Variable', 'Playfair Display Variable'].map(
    (family) => document.fonts.load(`16px "${family}"`)
  )
);
let dispose = () => {};
let leaseTimer: ReturnType<typeof setTimeout> | undefined;
declare global {
  interface Window {
    resetCanvasSnapshot: () => void;
    prepareCanvasRender: () => Promise<void>;
    canvasRenderIdle: boolean;
    renderCanvasSnapshot: (snapshot: {
      document: GraphicsDocument;
      crop: Bounds;
      scale: number;
      revision: string;
    }) => Promise<void>;
    measureCanvasSnapshot: (snapshot: {
      document: GraphicsDocument;
      requests: TextFitRequest[];
    }) => Promise<TextFitResult>;
    readCanvasTextLayout: () => {
      id: string;
      bounds: Bounds;
      overflow: boolean;
    }[];
  }
}

/** Browser-owned deadlines survive a lost Worker connection, including local CDP. */
window.canvasRenderIdle = true;
window.prepareCanvasRender = async () => {
  window.canvasRenderIdle = false;
  clearTimeout(leaseTimer);
  leaseTimer = setTimeout(() => {
    window.resetCanvasSnapshot();
    window.close();
  }, 150_000);
  await fontsReady;
  await document.fonts.ready;
};

/** Release all scene roots/closures before another authorized request leases this page. */
window.resetCanvasSnapshot = () => {
  window.canvasRenderIdle = true;
  dispose();
  dispose = () => {};
  document.getElementById('root')?.replaceChildren();
  window.readCanvasTextLayout = () => [];
  clearTimeout(leaseTimer);
  leaseTimer = setTimeout(() => window.close(), 60_000);
};

/** Uses the same StaticLexical/CSS/font measurer as live Canvas text editing. */
window.measureCanvasSnapshot = async (snapshot) => {
  await fontsReady;
  await document.fonts.ready;
  const measurer = createCanvasTextMeasurer();
  try {
    return fitTextLayout(
      snapshot.document,
      snapshot.requests,
      measurer.measure
    );
  } finally {
    measurer.dispose();
  }
};

/** Isolated static host: no session, persistence, authorization or editing adapters. */
window.renderCanvasSnapshot = async (snapshot) => {
  await fontsReady;
  dispose();
  const editor = createGraphicsEditor(snapshot.document);
  editor.zoomAt({ x: 0, y: 0 }, snapshot.scale);
  editor.panBy({
    x: -snapshot.crop.x * snapshot.scale,
    y: -snapshot.crop.y * snapshot.scale,
  });
  const root = document.getElementById('root');
  if (!root) throw new Error('Missing Canvas render root.');
  document.documentElement.style.colorScheme = 'light';
  const unmount = render(
    () => (
      <StaticMarkdownContext>
        <div
          data-canvas-revision={snapshot.revision}
          style={{
            position: 'fixed',
            inset: 0,
            background: '#ffffff',
            color: '#171717',
          }}
        >
          <GraphicsSurface
            editor={editor}
            hideSelection
            gridColor="transparent"
            input={{ editing: false }}
            renderers={{
              rectangle: (props) => (
                <RectangleView {...props} contentView={CanvasTextContent} />
              ),
              ellipse: (props) => (
                <EllipseView {...props} contentView={CanvasTextContent} />
              ),
              connector: (props) => (
                <ConnectorView {...props} contentView={CanvasTextContent} />
              ),
              text: (props) => (
                <TextView {...props} contentView={CanvasTextContent} />
              ),
              image: (props) => (
                <div class="size-full border border-edge-muted p-2 text-xs">
                  Image unavailable: {props.item.geometry.name}
                </div>
              ),
              video: (props) => (
                <div class="size-full border border-edge-muted p-2 text-xs">
                  Video unavailable: {props.item.geometry.name}
                </div>
              ),
              document: (props) => (
                <div class="size-full border border-edge-muted p-2 text-xs">
                  Document unavailable: {props.item.geometry.name}
                </div>
              ),
            }}
          />
        </div>
      </StaticMarkdownContext>
    ),
    root
  );
  dispose = () => {
    unmount();
    editor.dispose();
  };
  await fontsReady;
  await document.fonts.ready;
  window.readCanvasTextLayout = () =>
    Array.from(
      root.querySelectorAll<HTMLElement>('[data-graphics-item]')
    ).flatMap((element) => {
      const id = element.dataset.graphicsItem;
      const item = id ? snapshot.document.items[id] : undefined;
      const geometry =
        item?.type === 'text'
          ? item.geometry
          : canLabel(item)
            ? shapeLabelLayout(item)?.geometry
            : undefined;
      const text = element.querySelector<HTMLElement>('.graphics-rich-text');
      if (!geometry || !text || !id) return [];
      const rect = text.getBoundingClientRect();
      return [
        {
          id,
          bounds: {
            x: rect.x / snapshot.scale + snapshot.crop.x,
            y: rect.y / snapshot.scale + snapshot.crop.y,
            width: rect.width / snapshot.scale,
            height: rect.height / snapshot.scale,
          },
          overflow:
            text.scrollHeight > geometry.height + 1 ||
            text.scrollWidth > geometry.width + 1,
        },
      ];
    });
};

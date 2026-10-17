import { DesmosEngine } from '@core/desmos-engine/client';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { ExpressionList } from '../components/expression-list';
import { GraphPaper } from '../components/graph-paper';
import {
  type GraphDocument,
  type PlotScene,
  serializeDesmosDocument,
  type Viewport,
} from '../core/document';

export function DesmosEditor(props: {
  initial: GraphDocument;
  canEdit: boolean;
  nested: boolean;
  onChange: (document: GraphDocument) => void;
}) {
  const [document, setDocument] = createSignal(props.initial);
  const [scene, setScene] = createSignal<PlotScene>();
  const [status, setStatus] = createSignal<'loading' | 'ready' | 'error'>(
    'loading'
  );
  const engine = new DesmosEngine();
  let viewportTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingViewport: GraphDocument | undefined;

  onMount(() => {
    void engine
      .open(serializeDesmosDocument(props.initial))
      .then(async (opened) => {
        setDocument(opened);
        setScene(await engine.plot());
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  });
  onCleanup(() => {
    if (viewportTimer) clearTimeout(viewportTimer);
    if (pendingViewport) props.onChange(pendingViewport);
    engine.dispose();
  });

  const apply = (next: { document: GraphDocument; scene: PlotScene }) => {
    setDocument(next.document);
    setScene(next.scene);
    props.onChange(next.document);
  };

  const persistViewport = (next: {
    document: GraphDocument;
    scene: PlotScene;
  }) => {
    setDocument(next.document);
    setScene(next.scene);
    pendingViewport = next.document;
    if (viewportTimer) clearTimeout(viewportTimer);
    viewportTimer = setTimeout(() => {
      const doc = pendingViewport;
      pendingViewport = undefined;
      if (doc) props.onChange(doc);
    }, 400);
  };

  return (
    <div
      class="flex size-full min-h-0 min-w-0 bg-surface"
      classList={{ 'min-h-[360px]': props.nested }}
      data-testid="desmos-editor"
    >
      <Show when={status() === 'error'}>
        <div class="flex size-full items-center justify-center text-ink-muted text-sm">
          The graphing calculator could not load.
        </div>
      </Show>
      <Show when={status() !== 'error'}>
        <ExpressionList
          expressions={document().expressions}
          scene={scene()}
          canEdit={props.canEdit}
          onChange={(id, latex) => {
            void engine
              .setLatex(id, latex)
              .then(apply)
              .catch(() => setStatus('error'));
          }}
          onToggle={(id, hidden) => {
            void engine
              .setHidden(id, hidden)
              .then(apply)
              .catch(() => setStatus('error'));
          }}
          onColor={(id, color) => {
            void engine
              .setColor(id, color)
              .then(apply)
              .catch(() => setStatus('error'));
          }}
          onSlider={(id, value) => {
            void engine
              .setSlider(id, value)
              .then(apply)
              .catch(() => setStatus('error'));
          }}
          onAddSlider={(name) => {
            void engine
              .addSlider(name)
              .then(apply)
              .catch(() => setStatus('error'));
          }}
          onRemove={(id) => {
            void engine
              .remove(id)
              .then(apply)
              .catch(() => setStatus('error'));
          }}
          onAdd={() => {
            void engine
              .addExpression()
              .then(apply)
              .catch(() => setStatus('error'));
          }}
        />
        <GraphPaper
          scene={scene()}
          canEdit={props.canEdit}
          onViewport={(viewport: Viewport) => {
            void engine
              .setViewport(viewport)
              .then(persistViewport)
              .catch(() => setStatus('error'));
          }}
        />
      </Show>
    </div>
  );
}

import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableCanvasArtifacts } from '@core/constant/featureFlags';
import type { GraphicsEditor } from '@macro-inc/graphics';
import type { GraphicsPresence } from '@macro-inc/graphics/loro';
import {
  attachPresencePointer,
  GraphicsPresenceOverlay,
} from '@macro-inc/graphics/loro/solid';
import { GraphicsSurface } from '@macro-inc/graphics/solid';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import {
  ARTIFACT_CONTROLS_SELECTOR,
  ArtifactControls,
} from './artifact-controls';
import { ArtifactPresentation } from './artifact-presentation';
import { CanvasArtifactView } from './artifact-view';
import { CanvasDrawingToolbar, CanvasZoomToolbar } from './canvas-toolbars';
import { STATIC_ITEM_RENDERERS } from './static-item-renderers';

/** Viewers get navigation without mounting editing handlers or embedded editors. */
export function CanvasReadOnlyView(props: {
  editor: GraphicsEditor;
  presence?: GraphicsPresence;
  fitOnLoad?: boolean;
}) {
  const [tool, setTool] = createSignal<'select' | 'pan'>('select');
  const [activeArtifact, setActiveArtifact] = createSignal<string>();
  const [presenting, setPresenting] = createSignal<string>();
  const artifactsFlag = useFeatureFlag(enableCanvasArtifacts);
  const [scale, setScale] = createSignal(props.editor.getCamera().scale);
  const [hasSelection, setHasSelection] = createSignal(
    props.editor.getSession().selectedIds.length > 0
  );
  onCleanup(
    props.editor.subscribeSession((session) =>
      setHasSelection(session.selectedIds.length > 0)
    )
  );
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
  const fitSelection = () =>
    props.editor.fitSelection({
      width: host.clientWidth,
      height: host.clientHeight,
    });
  onMount(() => {
    if (props.presence)
      onCleanup(attachPresencePointer(host, props.editor, props.presence));
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
        if (event.key === '.') {
          if (hasSelection()) fitSelection();
          else fit();
        } else if (event.key.toLowerCase() === 'v') setTool('select');
        else if (event.key.toLowerCase() === 'h') setTool('pan');
        else return;
        event.preventDefault();
      }}
    >
      <GraphicsSurface
        editor={props.editor}
        input={{
          editing: false,
          tool,
          ignoreTarget: (target) =>
            target instanceof Element &&
            (!!target.closest(ARTIFACT_CONTROLS_SELECTOR) ||
              (!!target.closest('[data-graphics-item]') &&
                !!target.closest(
                  'button,a,input,select,textarea,[role="button"]'
                ))),
        }}
        gridColor="transparent"
        renderers={{
          ...STATIC_ITEM_RENDERERS,
          artifact: (p) => (
            <CanvasArtifactView
              {...p}
              active={activeArtifact() === p.item.id}
              onEnter={() => setActiveArtifact(p.item.id)}
              onExit={() => setActiveArtifact(undefined)}
            />
          ),
        }}
      >
        <Show when={artifactsFlag().enabled && !presenting()}>
          <ArtifactControls
            editor={props.editor}
            editable={false}
            activeId={activeArtifact()}
            onInteract={setActiveArtifact}
            onDone={() => setActiveArtifact(undefined)}
            onPresent={setPresenting}
          />
        </Show>
      </GraphicsSurface>
      <Show when={props.presence}>
        {(presence) => (
          <GraphicsPresenceOverlay
            editor={props.editor}
            presence={presence()}
          />
        )}
      </Show>
      <Show when={artifactsFlag().enabled ? presenting() : undefined} keyed>
        {(startId) => (
          <ArtifactPresentation
            editor={props.editor}
            startId={startId}
            onExit={() => {
              setPresenting(undefined);
              focus();
            }}
          />
        )}
      </Show>
      <CanvasDrawingToolbar
        readOnly
        tool={tool()}
        onTool={(next) => {
          if (next !== 'select' && next !== 'pan') return;
          setTool(next);
          focus();
        }}
      />
      <CanvasZoomToolbar
        scale={scale()}
        onZoom={zoom}
        onFit={fit}
        hasSelection={hasSelection()}
        onFitSelection={fitSelection}
      />
    </div>
  );
}

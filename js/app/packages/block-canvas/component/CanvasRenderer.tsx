import { useIsNestedBlock } from '@core/block';
import { LOCAL_ONLY } from '@core/constant/featureFlags';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { useCanEdit } from '@core/signal/permissions';
import Circuitry from '@icon/regular/circuitry.svg';
import { nanoid } from 'nanoid';
import {
  type Accessor,
  createMemo,
  For,
  type ParentProps,
  Show,
} from 'solid-js';
import { type RenderMode, RenderModes } from '../constants';
import type { CanvasEdge, CanvasId, CanvasNode } from '../model/CanvasModel';
import { useSelection } from '../signal/selection';
import {
  debugRenderQueue,
  previewRenderQueue,
  renderQueue,
  useCanvasEdges,
  useCanvasNodes,
} from '../store/canvasData';
import { useRenderState } from '../store/RenderState';
import { clamp } from '../util/math';
import type { RenderQueue } from '../util/renderQueue';
import { EdgeRenderer, NodeRenderer } from './BaseRenderer';
import { CenterContents } from './CenterContents';
import { FloatingMenu } from './FloatingMenu';
import { LayerContext } from './LayerContext';
import { PanWidget } from './PanWidget';
import { SelectionBox } from './SelectionBox';
import { SelectionRenderer } from './SelectionRenderer';
import { ZoomWidget } from './ZoomWidget';

export function NodeMap(props: { nodes: CanvasNode[]; mode: RenderMode }) {
  return (
    <For each={props.nodes}>
      {(node) => <NodeRenderer node={node} mode={props.mode} />}
    </For>
  );
}

export function EdgeMap(props: { edges: CanvasEdge[]; mode: RenderMode }) {
  return (
    <For each={props.edges}>
      {(edge) => <EdgeRenderer edge={edge} mode={props.mode} />}
    </For>
  );
}

export function MapRender(props: {
  queue: RenderQueue;
  mode: RenderMode;
  getNode: (id: CanvasId) => CanvasNode;
  getEdge: (id: CanvasId) => CanvasEdge;
}) {
  return (
    <For each={props.queue.sorted()}>
      {(renderable) => {
        if (renderable.type === 'node') {
          return (
            <NodeRenderer
              node={props.getNode(renderable.id)}
              mode={props.mode}
            />
          );
        }
        if (renderable.type === 'edge') {
          return (
            <EdgeRenderer
              edge={props.getEdge(renderable.id)}
              mode={props.mode}
            />
          );
        }
      }}
    </For>
  );
}

function DotPattern(props: {
  scale: Accessor<number>;
  x: Accessor<number>;
  y: Accessor<number>;
}) {
  const size = 25;
  const patternTransform = createMemo(() => {
    return `translate(${props.x()},${props.y()}) scale(${props.scale()})`;
  });
  const radius = createMemo(() => {
    return clamp(1 / props.scale(), 1, 2);
  });
  const id = `dot-pattern-${nanoid(6)}`;

  return (
    <svg class="absolute inset-0 w-full h-full">
      <defs>
        <pattern
          id={id}
          width={size.toString()}
          height={size.toString()}
          patternUnits="userSpaceOnUse"
          patternTransform={patternTransform()}
        >
          <circle
            cx={(size / 2).toString()}
            cy={(size / 2).toString()}
            r={radius().toString()}
            fill="#8B868022"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

function CanvasLayer(
  props: ParentProps<{
    x: Accessor<number>;
    y: Accessor<number>;
    z: Accessor<number>;
    scale: Accessor<number>;
    ref?: (el: HTMLDivElement) => void;
    inert?: boolean;
  }>
) {
  return (
    <div
      ref={props.ref}
      class="canvas-transform-root top-0 left-0 absolute"
      style={{
        transform: `translate(${props.x()}px, ${props.y()}px) scale(${props.scale()})`,
        'z-index': props.z(),
      }}
      inert={props.inert}
    >
      {props.children}
    </div>
  );
}

export function CanvasRenderer() {
  const canEdit = useCanEdit();
  const isNestedBlock = useIsNestedBlock();
  const { currentSize, currentScale, currentPosition } = useRenderState();
  const { selectionBox } = useSelection();
  const nodes = useCanvasNodes();
  const edges = useCanvasEdges();

  let baseLayerRef!: HTMLDivElement;
  let selectionLayerRef!: HTMLDivElement;
  let lineSelectionLayerRef!: HTMLDivElement;

  const canvasX = createMemo(() => {
    const w = currentSize()?.x;
    if (!w) return 0;
    return w / 2 + currentPosition().x;
  });

  const canvasY = createMemo(() => {
    const h = currentSize()?.y;
    if (!h) return 0;
    return h / 2 + currentPosition().y;
  });

  const scale = createMemo(() => currentScale());

  const visibleObjects = createMemo(() => {
    return nodes.visible().length > 0 || edges.visible().length > 0;
  });

  return (
    <LayerContext.Provider
      value={() => ({
        base: baseLayerRef,
        selection: selectionLayerRef,
        lineSelection: lineSelectionLayerRef,
      })}
    >
      <div class="absolute inset-0 w-full h-full pointer-events-none">
        <DotPattern scale={scale} x={canvasX} y={canvasY} />
      </div>

      <CanvasLayer
        x={canvasX}
        y={canvasY}
        z={() => 0}
        scale={scale}
        ref={(el) => {
          baseLayerRef = el;
        }}
        inert={isNestedBlock}
      >
        <Show when={LOCAL_ONLY}>
          <div class="pointer-events-none">
            <MapRender
              queue={debugRenderQueue()}
              mode={RenderModes.Basic}
              getNode={nodes.get}
              getEdge={edges.get}
            />
          </div>
        </Show>

        <MapRender
          queue={renderQueue()}
          mode={RenderModes.Basic}
          getNode={nodes.get}
          getEdge={edges.get}
        />

        <MapRender
          queue={previewRenderQueue()}
          mode={RenderModes.Preview}
          getNode={nodes.get}
          getEdge={edges.get}
        />

        {/* render the x and y axes for debugging  */}
        {/* SCUFFED THEMING: how do we want to define these colors?? */}
        <Show when={LOCAL_ONLY}>
          <div
            class="absolute bg-accent/25 -z-50"
            style={{
              width: 1 / scale() + 'px',
              height: '10000px',
              top: '-5000px',
              left: 0,
            }}
          ></div>
        </Show>
        <Show when={LOCAL_ONLY}>
          <div
            class="absolute bg-failure/25 -z-50"
            style={{
              height: 1 / scale() + 'px',
              width: '10000px',
              left: '-5000px',
              top: 0,
            }}
          ></div>
        </Show>
      </CanvasLayer>

      <CanvasLayer
        x={canvasX}
        y={canvasY}
        z={() => 1}
        scale={scale}
        ref={(el) => {
          selectionLayerRef = el;
        }}
        inert={isNestedBlock}
      />

      <CanvasLayer
        x={canvasX}
        y={canvasY}
        z={() => 2}
        scale={scale}
        inert={isNestedBlock}
      >
        <SelectionRenderer />
        <SelectionBox rect={selectionBox()} />
      </CanvasLayer>

      <CanvasLayer
        x={canvasX}
        y={canvasY}
        z={() => 3}
        scale={scale}
        ref={(el) => {
          lineSelectionLayerRef = el;
        }}
        inert={isNestedBlock}
      />

      <Show when={!visibleObjects()}>
        <div class="w-full h-full absolute top-0 left-0 flex flex-col text-center items-center justify-center gap-4 z-20 pointer-events-none">
          <Circuitry class="w-12 h-12 text-canvas" />
          <div class="w-80 h-14 text-ink-extra-muted">
            Create whiteboards, diagrams, mind maps, designs and more.
          </div>
        </div>
      </Show>

      <Show when={!isNestedBlock && canEdit()}>
        <div
          class={`w-full absolute flex ${isMobileWidth() && 'justify-center'}`}
        >
          <FloatingMenu />
        </div>
      </Show>

      <Show when={visibleObjects()}>
        <ZoomWidget />
        <CenterContents />
        <Show when={LOCAL_ONLY}>
          <PanWidget />
        </Show>
      </Show>
    </LayerContext.Provider>
  );
}

import { createCallback } from '@solid-primitives/rootless';
import { createMemo, onMount } from 'solid-js';
import { useToolManager } from '../signal/toolManager';
import {
  useBoundingBox,
  useCanvasEdges,
  useCanvasNodes,
} from '../store/canvasData';
import { useRenderState } from '../store/RenderState';
import { Rect } from '../util/rectangle';
import { vec2 } from '../util/vector2';

export const scrollToView = (animate?: boolean) => {
  const edges = useCanvasEdges();
  const nodes = useCanvasNodes();
  const renderState = useRenderState();
  const boundingBox = useBoundingBox();

  const visibleObjectsBounds = createMemo(() => {
    const freeEdges = edges
      .visible()
      .filter((edge) => edge.from.type === 'free' || edge.to.type === 'free');

    if (nodes.visible().length === 0 && freeEdges.length === 0) {
      return Rect.fromPoints(vec2(0, 0), vec2(0, 0));
    }

    return boundingBox(nodes.visible(), freeEdges);
  });

  const visible = visibleObjectsBounds();
  const center = visible.center;
  const { x: viewW, y: viewH } = renderState.currentSize();
  const wFit = visible.width === 0 ? 1 : viewW / (visible.width + 100);
  const hFit = visible.height === 0 ? 1 : viewH / (visible.height + 100);

  renderState.animateTo(
    {
      x: -center.x,
      y: -center.y,
      scale: Math.min(wFit, hFit),
    },
    animate ? 400 : 0,
    true
  );
};

export function CenterContents() {
  const edges = useCanvasEdges();
  const nodes = useCanvasNodes();
  const renderState = useRenderState();
  const toolManager = useToolManager();
  const boundingBox = useBoundingBox();
  let ref!: HTMLDivElement;

  const visibleObjectsBounds = createMemo(() => {
    const freeEdges = edges
      .visible()
      .filter((edge) => edge.from.type === 'free' || edge.to.type === 'free');

    if (nodes.visible().length === 0 && freeEdges.length === 0) {
      return Rect.fromPoints(vec2(0, 0), vec2(0, 0));
    }

    return boundingBox(nodes.visible(), freeEdges);
  });

  const contentVisible = createMemo(() => {
    if (nodes.visible().length === 0 && edges.visible().length === 0)
      return true;

    return visibleObjectsBounds().intersects(renderState.viewBox());
  });

  const handler = createCallback(() => {
    scrollToView(true);
  });

  onMount(() => {
    toolManager.ignoreMouseEvents(ref);
  });

  return (
    <div
      class="border-edge p-2 text-ink-muted absolute bottom-4 left-[50%] -translate-x-[50%] rounded-xl cursor-auto "
      classList={{
        invisible: contentVisible(),
      }}
      ref={ref}
      on:click={handler}
    >
      Scroll to content
    </div>
  );
}

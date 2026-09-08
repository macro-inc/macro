import ArrowsOut from '@phosphor-icons/core/regular/arrows-out-simple.svg?component-solid';
import GraphIcon from '@phosphor-icons/core/regular/graph.svg?component-solid';
import Minus from '@phosphor-icons/core/regular/minus.svg?component-solid';
import Plus from '@phosphor-icons/core/regular/plus.svg?component-solid';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import type {
  ActivityNetwork,
  NetworkNode,
  NetworkPerson,
  NetworkSelection,
} from '../core/activity-network';

export function ActivityNetworkBoard(props: {
  graph: ActivityNetwork;
  selection?: NetworkSelection;
  loading?: boolean;
  resetKey: string;
  onSelect: (selection: NetworkSelection | undefined) => void;
  onOpen: (id: string, newSplit: boolean) => void;
  nodeLabel: (node: NetworkNode) => string;
  personLabel: (person: NetworkPerson) => string;
  renderNode: (node: NetworkNode) => JSX.Element;
  renderPerson: (person: NetworkPerson) => JSX.Element;
}) {
  let board!: HTMLDivElement;
  const [viewport, setViewport] = createSignal({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = createSignal(false);
  const [positions, setPositions] = createStore<
    Record<string, { x: number; y: number }>
  >({});
  let nodeDrag:
    | {
        id: string;
        pointer: number;
        x: number;
        y: number;
        offsetX: number;
        offsetY: number;
        moved: boolean;
      }
    | undefined;
  let suppressClick = false;
  let bounds = { width: 0, height: 0 };
  let frame: number | undefined;
  let pending = viewport();
  const pointers = new Map<number, { x: number; y: number }>();
  let moved = false;
  const clamp = (scale: number) => Math.max(0.3, Math.min(2, scale));
  function apply(next: typeof pending) {
    pending = next;
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      setViewport(pending);
    });
  }
  function fit(minimumScale = 0.3) {
    if (!bounds.width || !props.graph.peopleCount) return;
    const points = props.graph.clusters.flatMap((cluster) => [
      ...cluster.nodes.map((node) => ({
        id: node.id,
        x: node.x,
        y: node.y,
        width: 184,
        height: 68,
      })),
      ...cluster.people.map((person) => ({
        id: person.id,
        x: person.x - 80,
        y: person.y,
        width: 160,
        height: 80,
      })),
    ]);
    const minX = Math.min(
      0,
      ...points.map((point) => point.x + (positions[point.id]?.x ?? 0))
    );
    const minY = Math.min(
      0,
      ...points.map((point) => point.y + (positions[point.id]?.y ?? 0))
    );
    const width =
      Math.max(
        props.graph.width,
        ...points.map(
          (point) => point.x + (positions[point.id]?.x ?? 0) + point.width
        )
      ) - minX;
    const height =
      Math.max(
        props.graph.height,
        ...points.map(
          (point) => point.y + (positions[point.id]?.y ?? 0) + point.height
        )
      ) - minY;
    const scale = clamp(
      Math.max(
        minimumScale === 1
          ? Math.min(1, (bounds.width - 64) / width)
          : minimumScale,
        Math.min((bounds.width - 64) / width, (bounds.height - 140) / height, 1)
      )
    );
    pending = {
      x: (bounds.width - width * scale) / 2 - minX * scale,
      y: Math.max(32, (bounds.height - height * scale) / 2 - 16) - minY * scale,
      scale,
    };
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    setViewport(pending);
  }
  function zoom(factor: number, x = bounds.width / 2, y = bounds.height / 2) {
    const previous = pending;
    const scale = clamp(previous.scale * factor);
    apply({
      scale,
      x: x - ((x - previous.x) * scale) / previous.scale,
      y: y - ((y - previous.y) * scale) / previous.scale,
    });
  }
  onMount(() => {
    const resize = () => {
      bounds = { width: board.clientWidth, height: board.clientHeight };
      fit(1);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(board);
    resize();
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = board.getBoundingClientRect();
        zoom(
          Math.exp(-event.deltaY * 0.008),
          event.clientX - rect.left,
          event.clientY - rect.top
        );
      } else {
        const unit =
          event.deltaMode === 1
            ? 16
            : event.deltaMode === 2
              ? bounds.height
              : 1;
        apply({
          ...pending,
          x: pending.x - event.deltaX * unit,
          y: pending.y - event.deltaY * unit,
        });
      }
    };
    board.addEventListener('wheel', wheel, { passive: false });
    onCleanup(() => {
      observer.disconnect();
      board.removeEventListener('wheel', wheel);
      if (frame !== undefined) cancelAnimationFrame(frame);
    });
  });
  // Fit the imperative camera on initial data and intentional filter changes.
  createEffect(() => {
    const count = props.graph.peopleCount + props.graph.itemCount;
    props.resetKey;
    if (count) untrack(() => fit(1));
  });
  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button'))
      return;
    event.preventDefault();
    board.focus({ preventScroll: true });
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    board.setPointerCapture(event.pointerId);
    setDragging(true);
    moved = false;
  }
  function pointerMove(event: PointerEvent) {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    const other = [...pointers.entries()].find(
      ([id]) => id !== event.pointerId
    )?.[1];
    if (other) {
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(next.x - other.x, next.y - other.y);
      const rect = board.getBoundingClientRect();
      if (before > 0)
        zoom(
          after / before,
          (next.x + other.x) / 2 - rect.left,
          (next.y + other.y) / 2 - rect.top
        );
    } else {
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      apply({ ...pending, x: pending.x + dx, y: pending.y + dy });
    }
    pointers.set(event.pointerId, next);
  }
  function startNodeDrag(event: PointerEvent, id: string) {
    if (event.button !== 0) return;
    event.stopPropagation();
    suppressClick = false;
    nodeDrag = {
      id,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: positions[id]?.x ?? 0,
      offsetY: positions[id]?.y ?? 0,
      moved: false,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  function moveNode(event: PointerEvent) {
    if (!nodeDrag || nodeDrag.pointer !== event.pointerId) return;
    const dx = event.clientX - nodeDrag.x;
    const dy = event.clientY - nodeDrag.y;
    if (Math.hypot(dx, dy) > 4) nodeDrag.moved = true;
    if (!nodeDrag.moved) return;
    event.preventDefault();
    setPositions(nodeDrag.id, {
      x: nodeDrag.offsetX + dx / pending.scale,
      y: nodeDrag.offsetY + dy / pending.scale,
    });
  }
  function endNodeDrag(event: PointerEvent) {
    if (!nodeDrag || nodeDrag.pointer !== event.pointerId) return;
    suppressClick = nodeDrag.moved;
    nodeDrag = undefined;
  }
  function selectNode(selection: NetworkSelection) {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    props.onSelect(selection);
  }
  function pointerUp(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (board.hasPointerCapture(event.pointerId))
      board.releasePointerCapture(event.pointerId);
    if (!pointers.size) {
      setDragging(false);
      if (!moved && event.type === 'pointerup') props.onSelect(undefined);
    }
  }
  function keyDown(event: KeyboardEvent) {
    if (event.target !== board) return;
    const offsets: Record<string, [number, number]> = {
      ArrowLeft: [60, 0],
      ArrowRight: [-60, 0],
      ArrowUp: [0, 60],
      ArrowDown: [0, -60],
    };
    if (offsets[event.key]) {
      event.preventDefault();
      const [x, y] = offsets[event.key];
      apply({ ...pending, x: pending.x + x, y: pending.y + y });
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoom(1.2);
    } else if (event.key === '-') {
      event.preventDefault();
      zoom(1 / 1.2);
    } else if (event.key === '0') {
      event.preventDefault();
      fit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      props.onSelect(undefined);
    }
  }
  const connected = (actorId: string, entityId: string) =>
    !props.selection ||
    (props.selection.kind === 'person'
      ? props.selection.id === actorId
      : props.selection.id === entityId);
  const nodeActive = (node: NetworkNode) =>
    !props.selection ||
    (props.selection.kind === 'entity'
      ? props.selection.id === node.id
      : node.actors.includes(props.selection.id));
  const personActive = (person: NetworkPerson) =>
    !props.selection ||
    (props.selection.kind === 'person'
      ? person.actorId === props.selection.id
      : props.graph.clusters.some((cluster) =>
          cluster.edges.some(
            (edge) =>
              edge.entityId === props.selection?.id &&
              edge.actorId === person.actorId
          )
        ));
  return (
    <div
      class="relative min-h-0 flex-1 overflow-hidden bg-page"
      data-activity-network
    >
      <div
        ref={board}
        role="region"
        aria-label="Activity graph. Drag to pan, pinch to zoom. Arrow keys pan, plus and minus zoom, zero fits the graph."
        tabindex="0"
        class="absolute inset-0 touch-none overflow-hidden outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
        classList={{
          'cursor-grabbing': dragging(),
          'cursor-grab': !dragging(),
        }}
        style={{
          'background-image':
            'radial-gradient(circle, color-mix(in srgb, var(--color-ink) 15%, transparent) 0.7px, transparent 0.7px)',
          'background-size': `${24 * viewport().scale}px ${24 * viewport().scale}px`,
          'background-position': `${viewport().x}px ${viewport().y}px`,
        }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onLostPointerCapture={pointerUp}
        onKeyDown={keyDown}
      >
        <div
          class="absolute left-0 top-0 origin-top-left will-change-transform"
          data-network-world
          style={{
            width: `${props.graph.width}px`,
            height: `${props.graph.height}px`,
            transform: `translate3d(${viewport().x}px, ${viewport().y}px, 0) scale(${viewport().scale})`,
          }}
        >
          <For each={props.graph.clusters}>
            {(cluster) => (
              <>
                <Show when={cluster.nodes.length > 0}>
                  <div
                    class="pointer-events-none absolute rounded-[48px] border border-dashed border-current/20 bg-current/[0.025]"
                    style={{
                      left: `${cluster.x}px`,
                      top: `${cluster.y}px`,
                      width: `${cluster.width}px`,
                      height: `${cluster.height}px`,
                      color: 'var(--color-ink-extra-muted)',
                    }}
                  >
                    <div class="px-7 pt-5">
                      <p class="text-[10px] text-ink-muted">
                        {cluster.nodes.length} work{' '}
                        {cluster.nodes.length === 1 ? 'item' : 'items'}
                      </p>
                    </div>
                  </div>
                </Show>
                <svg
                  class="pointer-events-none absolute inset-0 overflow-visible"
                  width={props.graph.width}
                  height={props.graph.height}
                  aria-hidden="true"
                >
                  <For each={cluster.edges}>
                    {(edge) => {
                      const geometry = createMemo(() => {
                        const sx =
                          edge.sourceX + (positions[edge.sourceId]?.x ?? 0);
                        const sy =
                          edge.sourceY + (positions[edge.sourceId]?.y ?? 0);
                        const tx =
                          edge.targetX + (positions[edge.entityId]?.x ?? 0);
                        const ty =
                          edge.targetY + (positions[edge.entityId]?.y ?? 0);
                        const x = (sx + tx) / 2;
                        return {
                          x,
                          y: (sy + ty) / 2,
                          path: `M ${sx} ${sy} C ${x} ${sy}, ${x} ${ty}, ${tx} ${ty}`,
                        };
                      });
                      return (
                        <g
                          opacity={
                            props.selection
                              ? connected(edge.actorId, edge.entityId)
                                ? 1
                                : 0.06
                              : cluster.people.some(
                                    (person) => person.actorId === edge.actorId
                                  )
                                ? 0.7
                                : 0.12
                          }
                        >
                          <path
                            d={geometry().path}
                            fill="none"
                            stroke={
                              props.selection &&
                              connected(edge.actorId, edge.entityId)
                                ? 'var(--color-accent)'
                                : 'var(--color-ink-extra-muted)'
                            }
                            stroke-width="1"
                            opacity="0.6"
                          />
                          <Show
                            when={
                              props.selection
                                ? connected(edge.actorId, edge.entityId)
                                : cluster.id === edge.actorId
                            }
                          >
                            <text
                              x={geometry().x}
                              y={geometry().y - 5}
                              text-anchor="middle"
                              class="fill-ink-muted text-[10px]"
                              stroke="var(--color-page)"
                              stroke-width="5"
                              stroke-linejoin="round"
                              paint-order="stroke"
                            >
                              {edge.label}
                            </text>
                          </Show>
                        </g>
                      );
                    }}
                  </For>
                </svg>
                <For each={cluster.nodes}>
                  {(node) => (
                    <button
                      type="button"
                      data-network-node={node.id}
                      aria-label={`Show activity for ${props.nodeLabel(node)}`}
                      aria-pressed={
                        props.selection?.kind === 'entity' &&
                        props.selection.id === node.id
                      }
                      title={`${props.nodeLabel(node)} · Double-click to open`}
                      class="absolute rounded-xl text-left outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-accent"
                      style={{
                        left: `${node.x + (positions[node.id]?.x ?? 0)}px`,
                        top: `${node.y + (positions[node.id]?.y ?? 0)}px`,
                        color: networkColor(node.entityType),
                        opacity: nodeActive(node) ? 1 : 0.24,
                      }}
                      onPointerDown={(event) => startNodeDrag(event, node.id)}
                      onPointerMove={moveNode}
                      onPointerUp={endNodeDrag}
                      onPointerCancel={endNodeDrag}
                      onLostPointerCapture={endNodeDrag}
                      onClick={() =>
                        selectNode({ kind: 'entity', id: node.id })
                      }
                      onDblClick={(event) =>
                        props.onOpen(node.id, event.shiftKey)
                      }
                    >
                      {props.renderNode(node)}
                    </button>
                  )}
                </For>
                <For each={cluster.people}>
                  {(person) => (
                    <button
                      type="button"
                      data-network-person={person.actorId}
                      aria-label={`Show activity by ${props.personLabel(person)}`}
                      aria-pressed={
                        props.selection?.kind === 'person' &&
                        props.selection.id === person.actorId
                      }
                      title={props.personLabel(person)}
                      class="absolute rounded-lg outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-accent"
                      style={{
                        left: `${person.x - 80 + (positions[person.id]?.x ?? 0)}px`,
                        top: `${person.y + (positions[person.id]?.y ?? 0)}px`,
                        opacity: personActive(person) ? 1 : 0.24,
                      }}
                      onPointerDown={(event) => startNodeDrag(event, person.id)}
                      onPointerMove={moveNode}
                      onPointerUp={endNodeDrag}
                      onPointerCancel={endNodeDrag}
                      onLostPointerCapture={endNodeDrag}
                      onClick={() =>
                        selectNode({ kind: 'person', id: person.actorId })
                      }
                    >
                      {props.renderPerson(person)}
                    </button>
                  )}
                </For>
              </>
            )}
          </For>
        </div>
      </div>
      <Show when={!props.graph.peopleCount}>
        <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <GraphIcon class="size-10 text-ink-extra-muted" />
          <p class="text-sm font-medium">
            {props.loading ? 'Mapping recent activity…' : 'No activity to map'}
          </p>
          <p class="max-w-64 text-xs leading-relaxed text-ink-muted">
            {props.loading
              ? 'Bringing people and their work together.'
              : 'Try another time range or clear your filters.'}
          </p>
        </div>
      </Show>
      <div class="pointer-events-none absolute bottom-5 left-5 flex items-center gap-5 rounded-xl border border-edge-muted bg-panel/95 px-4 py-3 shadow-sm">
        <For
          each={[
            { value: props.graph.peopleCount, label: 'People' },
            { value: props.graph.itemCount, label: 'Work items' },
            { value: props.graph.connectionCount, label: 'Connections' },
          ]}
        >
          {(stat) => (
            <div>
              <p class="text-sm font-semibold tabular-nums">{stat.value}</p>
              <p class="mt-0.5 text-[10px] text-ink-muted">{stat.label}</p>
            </div>
          )}
        </For>
      </div>
      <div class="absolute bottom-5 right-5 flex items-center rounded-lg border border-edge bg-panel shadow-sm">
        <BoardButton label="Zoom out" onClick={() => zoom(1 / 1.2)}>
          <Minus class="size-4" />
        </BoardButton>
        <button
          type="button"
          aria-label="Reset zoom to 100%"
          title="Reset to 100%"
          class="w-11 py-2 text-[11px] tabular-nums text-ink-muted hover:text-ink"
          onClick={() => zoom(1 / pending.scale)}
        >
          {Math.round(viewport().scale * 100)}%
        </button>
        <BoardButton label="Zoom in" onClick={() => zoom(1.2)}>
          <Plus class="size-4" />
        </BoardButton>
        <span class="h-4 w-px bg-edge" />
        <BoardButton label="Fit graph" onClick={() => fit()}>
          <ArrowsOut class="size-4" />
        </BoardButton>
      </div>
      <p class="pointer-events-none absolute left-5 top-4 text-[10px] text-ink-extra-muted">
        Drag to explore <span class="mx-1">·</span> Pinch to zoom{' '}
        <span class="mx-1">·</span> Select to focus
      </p>
      <Show when={props.graph.omittedItems > 0}>
        <p class="pointer-events-none absolute bottom-[92px] left-5 text-[10px] text-ink-muted">
          Showing {props.graph.itemCount} of{' '}
          {props.graph.itemCount + props.graph.omittedItems} loaded items ·
          Filter to focus
        </p>
      </Show>
    </div>
  );
}

function BoardButton(props: {
  label: string;
  onClick: () => void;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      class="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-hover hover:text-ink focus-visible:outline-accent"
    >
      {props.children}
    </button>
  );
}

function networkColor(kind: string): string {
  const colors: Record<string, string> = {
    channel: 'var(--color-note)',
    document: 'var(--color-write)',
    chat: 'var(--color-chat)',
    'email-thread': 'var(--color-snippet)',
    project: 'var(--color-folder)',
  };
  return colors[kind] ?? 'var(--color-ink-muted)';
}

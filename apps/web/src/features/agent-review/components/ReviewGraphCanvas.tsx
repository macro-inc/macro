import FitIcon from '@phosphor/arrows-out-simple.svg';
import MinusIcon from '@phosphor/minus.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Button } from '@ui';
import Color from 'colorjs.io';
import cytoscape, {
  type Core,
  type EdgeSingular,
  type NodeSingular,
} from 'cytoscape';
import { type IHTMLLayer, layers, renderPerNode } from 'cytoscape-layers';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { render } from 'solid-js/web';
import { type GraphFileSummary, graphChanges } from '../core/graph-changes';
import {
  type DetailLayout,
  graphDetail,
  graphDetailLayout,
  graphFocus,
  graphMaxZoom,
} from '../core/graph-detail';
import { graphNeighborhood, graphPath } from '../core/graph-hierarchy';
import { edgeSegments } from '../core/graph-layout';
import type { CodeLocation, GraphNode, ReviewGraph } from '../core/model';
import { ReviewGraphNode } from './ReviewGraphNode';

export default function ReviewGraphCanvas(props: {
  graph: ReviewGraph;
  files: GraphFileSummary[];
  compact?: boolean;
  activeNode?: string;
  onLocation: (at: CodeLocation, node?: string) => void;
}) {
  let container!: HTMLDivElement;
  let graph: Core | undefined;
  let reveal: ((id: string, open: boolean) => void) | undefined;
  let backDetail: (() => boolean) | undefined;
  const [hovered, setHovered] = createSignal<CodeLocation>();
  const changes = createMemo(() => graphChanges(props.graph, props.files));
  const drawing = createMemo(() =>
    props.compact
      ? graphNeighborhood(props.graph, props.activeNode)
      : props.graph
  );
  const revision = createMemo(() => JSON.stringify(drawing()));
  const [detail, setDetail] = createSignal({
    visible: new Set<string>(),
    expanded: new Set<string>(),
  });
  const [viewZoom, setViewZoom] = createSignal(1);
  const [trail, setTrail] = createSignal<GraphNode[]>([]);
  const [fileFocus, setFileFocus] = createSignal<string>();
  const fit = () => {
    if (!graph) return;
    setFileFocus(undefined);
    graph.fit(graph.elements('.root'), props.compact ? 18 : 28);
    if (graph.zoom() > 1.3) {
      graph.zoom(1.3);
      graph.center();
    }
  };
  const zoom = (factor: number) => {
    if (!graph) return;
    container.focus({ preventScroll: true });
    graph.zoom({
      level: Math.min(
        graph.maxZoom(),
        Math.max(graph.minZoom(), graph.zoom() * factor)
      ),
      renderedPosition: {
        x: container.clientWidth / 2,
        y: container.clientHeight / 2,
      },
    });
  };
  onMount(() => {
    // Keep wheel response consistent from the first event. Cytoscape's device
    // sampling otherwise changes sensitivity partway through a trackpad gesture.
    const scrollFiles = (event: WheelEvent) => {
      if (
        !event.ctrlKey &&
        event.target instanceof Element &&
        event.target.closest('[data-graph-files]')
      ) {
        event.stopImmediatePropagation();
        return;
      }
      if (props.compact || !graph || !event.deltaY) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? container.clientHeight
            : 1;
      const delta = Math.max(-160, Math.min(160, event.deltaY * unit));
      const bounds = container.getBoundingClientRect();
      graph.stop();
      graph.zoom({
        level: Math.max(
          graph.minZoom(),
          Math.min(
            graph.maxZoom(),
            graph.zoom() * Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.004))
          )
        ),
        renderedPosition: {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        },
      });
      container.focus({ preventScroll: true });
    };
    container.addEventListener('wheel', scrollFiles, {
      capture: true,
      passive: false,
    });
    const cy = cytoscape({
      container,
      elements: [],
      layout: { name: 'preset' },
      minZoom: props.compact ? 0.03 : 0.15,
      maxZoom: 4,
      autoungrabify: true,
      autounselectify: true,
      boxSelectionEnabled: false,
      userZoomingEnabled: !props.compact,
      userPanningEnabled: !props.compact,
    });
    graph = cy;
    let theme: MutationObserver | undefined;
    let resize: ResizeObserver | undefined;
    let labelLayer: IHTMLLayer | undefined;
    let labels: ReturnType<typeof renderPerNode> | undefined;
    const labelDisposers: (() => void)[] = [];
    const clearLabels = () => {
      labels?.remove();
      labels = undefined;
      for (const dispose of labelDisposers.splice(0)) dispose();
      labelLayer?.node.replaceChildren();
    };
    onCleanup(() => {
      container.removeEventListener('wheel', scrollFiles, true);
      theme?.disconnect();
      resize?.disconnect();
      clearLabels();
      cy.destroy();
      graph = undefined;
      reveal = undefined;
      backDetail = undefined;
    });
    if (!props.compact)
      cy.on('tapstart pinchzoom scrollzoom', () => {
        cy.stop();
        container.focus({ preventScroll: true });
      });
    if (!props.compact) {
      // Detail controls must sit above Cytoscape's gesture-capture canvas.
      // The layer itself passes through gestures; only its buttons receive them.
      labelLayer = layers(cy).append('html');
      labelLayer.node.style.pointerEvents = 'none';
      labelLayer.node.setAttribute('aria-hidden', 'true');
    }
    const locations = new Map<string, CodeLocation>();
    const color = (token: string) => {
      const probe = document.createElement('span');
      probe.style.color = `var(--color-${token})`;
      // A cached lazy component can mount while Suspense still holds its DOM
      // detached. Resolve global theme tokens on the connected document.
      document.documentElement.append(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return new Color(resolved).to('srgb').toString({ format: 'hex' });
    };
    const restyle = () => {
      const ink = color('ink'),
        muted = color('ink-muted'),
        subtle = color('ink-extra-muted'),
        panel = color('panel'),
        surface = color('surface'),
        edge = color('edge-muted'),
        accent = color('accent');
      const fontFamily = getComputedStyle(document.body).fontFamily;
      cy.style([
        {
          selector: 'node',
          style: {
            shape: 'round-rectangle',
            'corner-radius': 'data(radius)',
            width: 'data(width)',
            height: 'data(height)',
            'background-color': surface,
            'border-color': edge,
            'border-width': 'data(stroke)',
            label: props.compact ? 'data(label)' : '',
            color: ink,
            'font-size': 28,
            'z-index-compare': 'manual',
            'z-index': (node: NodeSingular) => node.data('depth'),
            'font-weight': 500,
            'font-family': fontFamily,
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'ellipsis',
            'text-max-width': '248px',
            'line-height': 1.4,
            'overlay-opacity': 0,
          },
        },
        {
          selector: 'edge',
          style: {
            'curve-style': 'round-segments',
            'edge-distances': 'node-position',
            'segment-weights': 'data(weights)',
            'segment-distances': 'data(distances)',
            'segment-radii': [20],
            width: 'data(stroke)',
            'line-color': subtle,
            'target-arrow-color': subtle,
            'target-arrow-shape': 'triangle',
            'arrow-scale': (edge: EdgeSingular) => edge.data('arrowScale'),
            label: props.compact ? '' : 'data(label)',
            'font-family': fontFamily,
            'font-size': 'data(fontSize)',
            color: muted,
            'text-background-color': panel,
            'text-background-opacity': 1,
            'text-background-padding': 'data(labelPadding)',
            'text-background-shape': 'roundrectangle',
            'text-wrap': 'ellipsis',
            'text-max-width': 'data(textWidth)',
            'overlay-opacity': 0,
          },
        },
        {
          selector: 'edge.direct',
          style: { 'curve-style': 'bezier' },
        },
        {
          selector: 'edge.from-group',
          style: { 'source-endpoint': '0% -30%', 'target-endpoint': '0% -50%' },
        },
        {
          selector: 'edge.to-group',
          style: { 'source-endpoint': '0% -50%', 'target-endpoint': '0% -30%' },
        },
        {
          selector: '.detail-hidden',
          style: { visibility: 'hidden' },
        },
        {
          selector: 'node.expanded',
          style: {
            'background-color': panel,
            'background-opacity': 0.6,
          },
        },
        {
          selector: 'node.hover',
          style: { 'border-color': accent },
        },
        {
          selector: 'node.active',
          style: {
            'border-color': accent,
            'border-width': props.compact
              ? 6
              : (node: NodeSingular) => Number(node.data('stroke')) * 1.7,
            'background-color': accent,
            'background-opacity': props.compact ? 0.18 : 0.08,
          },
        },
        {
          selector: 'edge.quiet',
          style: { opacity: 0.2 },
        },
        {
          selector: 'edge.hover, edge.related',
          style: {
            'line-color': accent,
            'target-arrow-color': accent,
            color: accent,
          },
        },
      ]);
    };
    restyle();
    theme = new MutationObserver(restyle);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class', 'data-theme'],
    });
    cy.on('tap', 'node, edge', (event) => {
      const location = locations.get(event.target.id());
      if (location)
        props.onLocation(
          location,
          event.target.isNode()
            ? String(event.target.data('nodeId'))
            : undefined
        );
    });
    cy.on('mouseover', 'node, edge', (event) => {
      const location = locations.get(event.target.id());
      if (location) {
        event.target.addClass('hover');
        setHovered(location);
        if (event.target.isNode()) {
          cy.edges().addClass('quiet');
          event.target
            .connectedEdges()
            .removeClass('quiet')
            .addClass('related');
        }
      }
    });
    cy.on('mouseout', 'node, edge', (event) => {
      event.target.removeClass('hover');
      setHovered(undefined);
      cy.edges().removeClass('quiet related');
    });
    let layouts: DetailLayout[] = [];
    let current: DetailLayout | undefined;
    const updateTrail = () => {
      if (!current || props.compact) return;
      const pan = cy.pan(),
        level = cy.zoom();
      const focus = graphFocus(
        current,
        {
          x: (cy.width() / 2 - pan.x) / level,
          y: (cy.height() / 2 - pan.y) / level,
        },
        detail().expanded
      );
      setTrail(focus ? graphPath(props.graph.nodes, focus.id) : []);
    };
    const focus = (node: { x: number; y: number }, requested: number) => {
      const level = Math.min(cy.maxZoom(), Math.max(cy.minZoom(), requested));
      const pan = {
        x: cy.width() / 2 - node.x * level,
        y: cy.height() / 2 - node.y * level,
      };
      container.focus({ preventScroll: true });
      cy.stop();
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        cy.zoom(level);
        cy.pan(pan);
      } else
        cy.animate(
          { zoom: level, pan },
          { duration: 200, easing: 'ease-out-cubic' }
        );
    };
    const ancestorZoom = (id: string) =>
      graphPath(props.graph.nodes, id)
        .slice(0, -1)
        .map(
          (ancestor) =>
            current!.nodes.find((node) => node.id === ancestor.id)!.expandAt *
            1.04
        );
    reveal = (id, open) => {
      const node = current?.nodes.find((node) => node.id === id);
      if (!node || !node.children) return;
      setFileFocus(undefined);
      focus(
        node,
        Math.max(
          open
            ? node.expandAt * 1.04
            : Math.min(280 / node.width, node.expandAt * 0.75),
          ...ancestorZoom(id)
        )
      );
    };
    const revealFiles = (id: string, open: boolean) => {
      const node = current?.nodes.find((node) => node.id === id);
      if (!node) return;
      setFileFocus(open ? id : undefined);
      focus(
        node,
        open
          ? Math.max(
              // Cross the collapse threshold when coming back from child nodes.
              Math.min(
                node.expandAt * 0.78,
                Math.max(
                  Math.max(340, Math.min(520, cy.width() - 32)) / node.width,
                  220 / node.height
                )
              ),
              ...ancestorZoom(id)
            )
          : 280 / node.width
      );
    };
    backDetail = () => {
      if (props.compact) return false;
      const files = fileFocus();
      if (files) {
        revealFiles(files, false);
        return true;
      }
      const group = trail().at(-1);
      if (group) {
        reveal?.(group.id, false);
        return true;
      }
      if (detail().expanded.size) {
        fit();
        return true;
      }
      return false;
    };
    const updateDetail = () => {
      if (!current) return;
      const level = cy.zoom();
      const next = graphDetail(
        current,
        props.compact ? 0 : level,
        detail().expanded
      );
      setViewZoom(level);
      setDetail(next);
      cy.batch(() => {
        cy.nodes().forEach((node) => {
          const unit = Math.min(node.data('width') / 300, 1 / level);
          node.data({ stroke: 1.5 * unit, radius: 20 * unit });
          node.toggleClass(
            'detail-hidden',
            !next.visible.has(node.data('nodeId'))
          );
          node.toggleClass('expanded', next.expanded.has(node.data('nodeId')));
        });
        cy.edges().forEach((edge) => {
          const unit = Math.min(edge.data('scale'), 1 / level);
          edge.data({
            stroke: 1.5 * unit,
            fontSize: 11 * unit,
            arrowScale: 0.8 * unit,
            labelPadding: 4 * unit,
            textWidth: 160 * unit,
          });
          edge.toggleClass(
            'detail-hidden',
            Boolean(edge.data('scope')) &&
              !next.expanded.has(edge.data('scope'))
          );
        });
      });
      updateTrail();
    };
    cy.on('zoom', updateDetail);
    cy.on('pan', updateTrail);
    const draw = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height || !layouts.length) return;
      const score = (map: DetailLayout) =>
        Math.min(
          width / Math.max(1, map.width),
          height / Math.max(1, map.height)
        );
      // Resizing and background captures preserve the reader's viewport.
      const map =
        current && layouts.includes(current)
          ? current
          : layouts.reduce((best, next) =>
              score(next) > score(best) ? next : best
            );
      cy.resize();
      if (current === map) {
        if (props.compact) fit();
        updateTrail();
        return;
      }
      const initial = !current;
      current = map;
      clearLabels();
      locations.clear();
      setHovered(undefined);
      cy.maxZoom(graphMaxZoom(map));
      cy.batch(() => {
        cy.elements().remove();
        const nodes = new Map(map.nodes.map((node) => [node.id, node]));
        for (const node of map.nodes) {
          const id = `node:${node.id}`;
          locations.set(id, node.location);
          cy.add({
            classes: node.parent ? 'detail-hidden' : 'root',
            data: {
              id,
              nodeId: node.id,
              label: node.title,
              path: node.location.path,
              width: node.width,
              height: node.height,
              depth: node.depth,
              stroke: 1.5,
              radius: 20,
            },
            position: { x: node.x, y: node.y },
          });
        }
        for (const edge of map.edges) {
          const id = `edge:${edge.key}`;
          if (edge.location) locations.set(id, edge.location);
          const segments = edgeSegments(
            edge.points,
            nodes.get(edge.from)!,
            nodes.get(edge.to)!
          );
          cy.add({
            classes: [
              edge.scope ? 'detail-hidden' : 'root',
              edge.from === edge.scope ? 'from-group' : '',
              edge.to === edge.scope ? 'to-group' : '',
              edge.from === edge.to || !edge.points.length ? 'direct' : '',
            ].join(' '),
            data: {
              id,
              source: `node:${edge.from}`,
              target: `node:${edge.to}`,
              label: edge.label,
              weights: segments.weights,
              distances: segments.distances,
              scope: edge.scope,
              scale: edge.scale,
              stroke: 1.5 * edge.scale,
              fontSize: 11 * edge.scale,
              arrowScale: 0.8 * edge.scale,
              labelPadding: 4 * edge.scale,
              textWidth: 160 * edge.scale,
            },
          });
        }
      });
      updateDetail();
      if (labelLayer) {
        labels = renderPerNode(labelLayer, () => {}, {
          selector: 'node',
          position: 'center',
          checkBounds: false,
          uniqueElements: true,
          updateOn: 'none',
          init: (element, node) => {
            const item = map.nodes.find(
              (item) => item.id === node.data('nodeId')
            )!;
            element.style.zIndex = String(item.depth);
            labelDisposers.push(
              render(
                () => (
                  <ReviewGraphNode
                    node={item}
                    changes={
                      changes().get(item.id) ?? {
                        files: [],
                        added: 0,
                        removed: 0,
                      }
                    }
                    zoom={viewZoom()}
                    expanded={detail().expanded.has(item.id)}
                    visible={detail().visible.has(item.id)}
                    browseFiles={fileFocus() === item.id}
                    onExplore={() =>
                      reveal?.(item.id, !detail().expanded.has(item.id))
                    }
                    onFiles={(open) => revealFiles(item.id, open)}
                    onLocation={(location) =>
                      props.onLocation(location, item.id)
                    }
                  />
                ),
                element
              )
            );
          },
        });
      }
      cy.nodes().forEach((node) => {
        node.toggleClass('active', node.data('nodeId') === props.activeNode);
      });
      if (initial || props.compact) {
        fit();
        const focus = map.nodes.find((node) => node.id === props.activeNode);
        if (!props.compact && focus) {
          setFileFocus(focus.id);
          const path = graphPath(props.graph.nodes, focus.id);
          const level = Math.max(
            1,
            360 / focus.width,
            ...path
              .slice(0, -1)
              .map(
                (node) =>
                  map.nodes.find((placed) => placed.id === node.id)!.expandAt *
                  1.02
              )
          );
          cy.zoom(level);
          cy.pan({
            x: width / 2 - focus.x * level,
            y: height / 2 - focus.y * level,
          });
        } else if (!props.compact && width < 700 && cy.zoom() < 0.72) {
          // A phone starts at a readable card; wider screens frame the whole map.
          const first = cy.nodes('.root').first().position();
          cy.zoom(0.72);
          cy.pan({ x: width / 2 - first.x * 0.72, y: 100 - first.y * 0.72 });
        }
      }
    };
    createEffect(
      on(revision, () => {
        const map = drawing();
        layouts = map.direction
          ? [
              graphDetailLayout(
                map,
                map.direction === 'leftToRight' ? 'LR' : 'TB'
              ),
            ]
          : [graphDetailLayout(map, 'LR'), graphDetailLayout(map, 'TB')];
        draw();
      })
    );
    resize = new ResizeObserver(draw);
    resize.observe(container);
    createEffect(() => {
      cy.nodes().forEach((node) => {
        node.toggleClass('active', node.data('nodeId') === props.activeNode);
      });
    });
  });
  return (
    <>
      <div
        ref={container}
        class="min-h-0 w-full flex-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-edge-focus"
        style={{
          'background-image': props.compact
            ? undefined
            : 'radial-gradient(var(--color-edge-muted) 1px, transparent 1px)',
          'background-size': '24px 24px',
        }}
        role="group"
        aria-label={
          props.compact
            ? 'Component minimap'
            : 'Component diagram. Drag to pan, scroll or pinch to zoom into component details. Code links follow in keyboard order.'
        }
        tabIndex={props.compact ? -1 : 0}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && backDetail?.()) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          const movements: Record<string, [number, number] | undefined> = {
            ArrowLeft: [64, 0],
            ArrowRight: [-64, 0],
            ArrowUp: [0, 64],
            ArrowDown: [0, -64],
          };
          const movement = movements[event.key];
          if (movement) {
            event.preventDefault();
            event.stopPropagation();
            graph?.panBy({ x: movement[0], y: movement[1] });
          } else if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            zoom(1.2);
          } else if (event.key === '-') {
            event.preventDefault();
            zoom(1 / 1.2);
          } else if (event.key.toLowerCase() === 'f') {
            event.preventDefault();
            fit();
          }
        }}
      />
      <Show when={!props.compact}>
        <div class="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
          <Show
            when={trail().length}
            fallback={
              <p class="min-w-0 truncate text-xs text-ink-muted">
                <Show
                  when={hovered()}
                  fallback={
                    <>
                      {props.graph.nodes.length} components{' '}
                      <span class="px-1 text-ink-extra-muted">·</span>{' '}
                      {props.graph.edges.length} connections
                    </>
                  }
                >
                  {(location) => (
                    <span class="font-mono" title={location().path}>
                      {location().path}:{location().line}
                    </span>
                  )}
                </Show>
              </p>
            }
          >
            <nav
              aria-label="Diagram location"
              class="flex min-w-0 flex-1 basis-48 items-center gap-1 text-xs text-ink-muted"
            >
              <Button
                size="sm"
                variant="ghost"
                class="h-7 shrink-0 px-2 text-xs"
                onClick={fit}
              >
                Overview
              </Button>
              <For each={trail()}>
                {(node, index) => (
                  <span
                    class={`flex min-w-0 items-center gap-1 ${index() < trail().length - 1 ? '@max-[700px]/review:hidden' : ''}`}
                  >
                    <span class="text-ink-extra-muted">/</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      class="h-7 min-w-0 shrink px-2 text-xs"
                      onClick={() => reveal?.(node.id, true)}
                    >
                      <span class="truncate">{node.title}</span>
                    </Button>
                  </span>
                )}
              </For>
            </nav>
          </Show>
          <div class="ml-auto flex shrink-0 items-center gap-1 rounded-xl border border-edge-muted bg-surface p-1">
            <Button
              size="icon-sm"
              variant="ghost"
              label="Zoom out"
              onClick={() => zoom(1 / 1.2)}
            >
              <MinusIcon />
            </Button>
            <span
              class="w-10 text-center text-[10px] tabular-nums text-ink-muted"
              aria-label="Diagram zoom"
            >
              {Math.round(viewZoom() * 100)}%
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              label="Fit map"
              onClick={fit}
            >
              <FitIcon />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              label="Zoom in"
              onClick={() => zoom(1.2)}
            >
              <PlusIcon />
            </Button>
          </div>
        </div>
      </Show>
    </>
  );
}

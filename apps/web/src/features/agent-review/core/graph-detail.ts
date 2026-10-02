import { graphRelationships } from './graph-hierarchy';
import { graphLayout } from './graph-layout';
import type { GraphNode, ReviewGraph } from './model';

export type DetailNode = GraphNode & {
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  children: number;
  expandAt: number;
};

export type DetailLayout = {
  width: number;
  height: number;
  nodes: DetailNode[];
  edges: (ReturnType<typeof graphRelationships>[number] & {
    points: { x: number; y: number }[];
    scale: number;
  })[];
};

/** Precompute nested Dagre layouts. Zoom changes visibility, never geometry. */
export function graphDetailLayout(
  map: ReviewGraph,
  direction: 'LR' | 'TB'
): DetailLayout {
  const relationships = graphRelationships(map);
  const result: DetailLayout = { width: 0, height: 0, nodes: [], edges: [] };
  const visit = (parent?: DetailNode) => {
    const nodes = map.nodes.filter(
      (node) => (node.parent ?? undefined) === parent?.id
    );
    if (!nodes.length) return;
    const edges = relationships.filter((edge) => edge.scope === parent?.id);
    const routed = edges.filter(
      (edge) => edge.from !== parent?.id && edge.to !== parent?.id
    );
    const scope = { title: map.title, nodes, edges: routed };
    // Reserve a header above children; both orientations use library edge routing.
    const space = parent
      ? {
          width: parent.width - (28 * parent.width) / 300,
          height: parent.height * 0.72,
        }
      : undefined;
    const fit = (layout: ReturnType<typeof graphLayout>) =>
      space
        ? Math.min(space.width / layout.width, space.height / layout.height)
        : 1;
    const layouts = parent
      ? [graphLayout(scope, 'LR'), graphLayout(scope, 'TB')]
      : [graphLayout(scope, direction)];
    const layout = layouts.reduce((best, next) =>
      fit(next) > fit(best) ? next : best
    );
    const scale = fit(layout);
    const x = parent && space ? parent.x - (layout.width * scale) / 2 : 0;
    const y =
      parent && space
        ? parent.y -
          parent.height / 2 +
          parent.height * 0.22 +
          (space.height - layout.height * scale) / 2
        : 0;
    const transform = (point: { x: number; y: number }) => ({
      x: x + point.x * scale,
      y: y + point.y * scale,
    });
    if (!parent) {
      result.width = layout.width;
      result.height = layout.height;
    }
    const placed = layout.nodes.map(
      (node): DetailNode => ({
        ...node,
        ...transform(node),
        width: node.width * scale,
        height: node.height * scale,
        depth: parent ? parent.depth + 1 : 0,
        children: map.nodes.filter((child) => child.parent === node.id).length,
        expandAt: Number.POSITIVE_INFINITY,
      })
    );
    if (parent)
      parent.expandAt = Math.max(
        620 / parent.width,
        180 / Math.min(...placed.map((node) => node.width))
      );
    result.nodes.push(...placed);
    for (const [index, edge] of routed.entries())
      result.edges.push({
        ...edge,
        points: layout.edges[index].points.map(transform),
        scale,
      });
    for (const edge of edges.filter((edge) => !routed.includes(edge)))
      result.edges.push({ ...edge, points: [], scale });
    for (const node of placed) visit(node);
  };
  visit();
  return result;
}

/** Hysteresis avoids detail flicker near a threshold during wheel or pinch zoom. */
export function graphDetail(
  layout: DetailLayout,
  zoom: number,
  previous: ReadonlySet<string>
) {
  const visible = new Set<string>();
  const expanded = new Set<string>();
  for (const node of layout.nodes) {
    if (node.parent && !expanded.has(node.parent)) continue;
    visible.add(node.id);
    if (zoom >= node.expandAt * (previous.has(node.id) ? 0.82 : 1))
      expanded.add(node.id);
  }
  return { visible, expanded };
}

/** All authored levels must be reachable, including a short leaf inside tall parents. */
export function graphMaxZoom(layout: DetailLayout) {
  return Math.max(
    4,
    ...layout.nodes.map((node) =>
      Math.max(
        640 / node.width,
        Number.isFinite(node.expandAt) ? node.expandAt * 1.6 : 0
      )
    )
  );
}

/** The deepest open group enclosing the viewport center supplies navigation context. */
export function graphFocus(
  layout: DetailLayout,
  point: { x: number; y: number },
  expanded: ReadonlySet<string>
) {
  return layout.nodes
    .filter(
      (node) =>
        expanded.has(node.id) &&
        Math.abs(node.x - point.x) < node.width / 2 &&
        Math.abs(node.y - point.y) < node.height / 2
    )
    .reduce<DetailNode | undefined>(
      (best, node) => (!best || node.depth > best.depth ? node : best),
      undefined
    );
}

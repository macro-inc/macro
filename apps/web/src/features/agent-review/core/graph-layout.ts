import {
  type EdgeLabel,
  Graph,
  type GraphLabel,
  layout,
  type NodeLabel,
  type Point,
} from '@dagrejs/dagre';
import type { ReviewGraph } from './model';

/** Layout consumes bounded, validated metadata; the renderer only receives geometry. */
export function graphLayout(map: ReviewGraph, direction: 'LR' | 'TB' = 'LR') {
  const graph = new Graph<GraphLabel, NodeLabel, EdgeLabel>({
    multigraph: true,
  })
    .setGraph({
      rankdir: direction,
      nodesep: 40,
      ranksep: 40,
      marginx: 24,
      marginy: 24,
    })
    .setDefaultEdgeLabel(() => ({}));
  for (const node of map.nodes)
    graph.setNode(node.id, {
      width: 300,
      height: node.description ? 240 : 180,
    });
  for (const [index, edge] of map.edges.entries())
    graph.setEdge(
      edge.from,
      edge.to,
      {
        width: Math.min(160, edge.label.length * 6),
        height: 24,
        labelpos: 'c',
      },
      String(index)
    );
  layout(graph);
  return {
    width: graph.graph().width ?? 0,
    height: graph.graph().height ?? 0,
    nodes: map.nodes.map((node) => {
      const bounds = graph.node(node.id)!;
      return {
        ...node,
        x: bounds.x ?? 0,
        y: bounds.y ?? 0,
        width: bounds.width,
        height: bounds.height,
      };
    }),
    edges: map.edges.map((edge, index) => ({
      ...edge,
      points: graph.edge(edge.from, edge.to, String(index)).points ?? [],
    })),
  };
}

/** Convert Dagre's routed bends into Cytoscape's node-relative segment coordinates. */
export function edgeSegments(points: Point[], source: Point, target: Point) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  if (!length) return { weights: [], distances: [] };
  const bends = points.slice(1, -1);
  return {
    weights: bends.map(
      (point) =>
        ((point.x - source.x) * dx + (point.y - source.y) * dy) / length ** 2
    ),
    distances: bends.map(
      (point) =>
        ((point.y - source.y) * dx - (point.x - source.x) * dy) / length
    ),
  };
}

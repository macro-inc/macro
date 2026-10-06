import type { GraphNode, ReviewGraph } from './model';

/** Root-to-component ancestry. Bounded defensively for older persisted metadata. */
export function graphPath(nodes: GraphNode[], id: string) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path: GraphNode[] = [];
  const seen = new Set<string>();
  let node = byId.get(id);
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    path.unshift(node);
    node = node.parent ? byId.get(node.parent) : undefined;
  }
  return path;
}

/** Draw relationships at their nearest shared scope, retaining each call-site link. */
export function graphRelationships(graph: ReviewGraph) {
  const paths = new Map(
    graph.nodes.map((node) => [node.id, graphPath(graph.nodes, node.id)])
  );
  return graph.edges.map((edge, key) => {
    const from = paths.get(edge.from) ?? [];
    const to = paths.get(edge.to) ?? [];
    let shared = 0;
    while (from[shared] && from[shared]?.id === to[shared]?.id) shared++;
    if (edge.from === edge.to) shared--;
    return {
      ...edge,
      key,
      scope: from[shared - 1]?.id,
      from: from[shared]?.id ?? edge.from,
      to: to[shared]?.id ?? edge.to,
    };
  });
}

/** The corner map shows the visited component alongside its siblings. */
export function graphNeighborhood(
  graph: ReviewGraph,
  active?: string
): ReviewGraph {
  const scope =
    graph.nodes.find((node) => node.id === active)?.parent ?? undefined;
  return {
    ...graph,
    direction: undefined,
    nodes: graph.nodes
      .filter((node) => (node.parent ?? undefined) === scope)
      .map((node) => ({ ...node, parent: undefined, description: undefined })),
    edges: graphRelationships(graph).filter(
      (edge) => edge.scope === scope && edge.from !== scope && edge.to !== scope
    ),
  };
}

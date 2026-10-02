import { expect, it } from 'vitest';
import { edgeSegments, graphLayout } from './graph-layout';

it('lays out branching and cyclic maps without losing code links', () => {
  const nodes = ['ui', 'service', 'db'].map((id) => ({
    id,
    title: id,
    location: { path: `${id}.ts`, side: 'new' as const, line: 1 },
  }));
  const edges = [
    { from: 'ui', to: 'service', label: 'calls' },
    { from: 'service', to: 'db', label: 'stores' },
    { from: 'db', to: 'service', label: 'returns' },
  ];
  const drawing = graphLayout({ title: 'Request', nodes, edges });
  expect(drawing.nodes.map((node) => node.location)).toEqual(
    nodes.map((node) => node.location)
  );
  expect(
    drawing.nodes.every(
      (node) => Number.isFinite(node.x) && Number.isFinite(node.y)
    )
  ).toBe(true);
  expect(new Set(drawing.nodes.map((node) => `${node.x}:${node.y}`)).size).toBe(
    3
  );
  expect(drawing.width).toBeGreaterThan(0);
  expect(
    drawing.edges.map(({ points, ...edge }) => {
      expect(points.length).toBeGreaterThanOrEqual(3);
      return edge;
    })
  ).toEqual(edges);
});

it('preserves separate routes for parallel edges and converts their bends without moving them', () => {
  const map = {
    title: 'Feedback',
    nodes: ['reader', 'agent'].map((id) => ({
      id,
      title: id,
      location: { path: `${id}.ts`, side: 'new' as const, line: 1 },
    })),
    edges: [
      { from: 'reader', to: 'agent', label: 'Comment' },
      { from: 'reader', to: 'agent', label: 'Capture' },
      { from: 'agent', to: 'reader', label: 'Reply' },
      { from: 'agent', to: 'agent', label: 'Retry' },
    ],
  };
  for (const direction of ['LR', 'TB'] as const) {
    const drawing = graphLayout(map, direction);
    expect(drawing.edges[0].points).not.toEqual(drawing.edges[1].points);
    for (const edge of drawing.edges) {
      const source = drawing.nodes.find((node) => node.id === edge.from)!;
      const target = drawing.nodes.find((node) => node.id === edge.to)!;
      const { weights, distances } = edgeSegments(edge.points, source, target);
      if (edge.from === edge.to) {
        expect(weights).toEqual([]);
        continue;
      }
      const dx = target.x - source.x,
        dy = target.y - source.y;
      const length = Math.hypot(dx, dy);
      for (const [index, point] of edge.points.slice(1, -1).entries()) {
        expect(
          source.x + dx * weights[index] - (dy / length) * distances[index]
        ).toBeCloseTo(point.x);
        expect(
          source.y + dy * weights[index] + (dx / length) * distances[index]
        ).toBeCloseTo(point.y);
      }
    }
  }
});

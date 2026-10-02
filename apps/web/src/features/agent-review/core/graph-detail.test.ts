import { expect, it } from 'vitest';
import { graphChanges } from './graph-changes';
import {
  graphDetail,
  graphDetailLayout,
  graphFocus,
  graphMaxZoom,
} from './graph-detail';
import { graphNeighborhood, graphPath } from './graph-hierarchy';
import type { ReviewGraph } from './model';

const graph: ReviewGraph = {
  title: 'Review',
  nodes: [
    ['ui', undefined],
    ['runtime', undefined],
    ['reader', 'ui'],
    ['map', 'ui'],
    ['renderer', 'map'],
    ['layout', 'map'],
    ['engine', 'runtime'],
  ].map(([id, parent]) => ({
    id: id!,
    parent,
    title: id!,
    description: `Changes to ${id}`,
    location: { path: `${id}.ts`, side: 'new', line: 1 },
  })),
  edges: [
    { from: 'ui', to: 'runtime', label: 'capture' },
    { from: 'reader', to: 'map', label: 'locate' },
    { from: 'renderer', to: 'layout', label: 'position' },
    {
      from: 'renderer',
      to: 'engine',
      label: 'read',
      location: { path: 'renderer.ts', side: 'new', line: 12 },
    },
    { from: 'ui', to: 'reader', label: 'contains' },
    { from: 'map', to: 'map', label: 'refresh' },
  ],
};

it('allows zooming through four levels even when the final card is shorter', () => {
  const map: ReviewGraph = {
    title: 'Deep detail',
    edges: [],
    nodes: ['root', 'service', 'module', 'function'].map((id, index, ids) => ({
      id,
      title: id,
      parent: ids[index - 1],
      description: index < 3 ? 'Detailed explanation' : undefined,
      location: { path: `${id}.ts`, side: 'new', line: 1 },
    })),
  };
  const layout = graphDetailLayout(map, 'LR');
  expect(
    graphDetail(layout, graphMaxZoom(layout), new Set()).visible.size
  ).toBe(4);
});

it('reveals nested detail in fixed bounds and uses hysteresis without moving any component', () => {
  const layout = graphDetailLayout(graph, 'LR');
  const geometry = JSON.stringify(layout);
  const initial = graphDetail(layout, 0.8, new Set());
  expect([...initial.visible]).toEqual(['ui', 'runtime']);
  const ui = layout.nodes.find((node) => node.id === 'ui')!;
  const opened = graphDetail(layout, ui.expandAt * 1.01, initial.expanded);
  expect(opened.visible.has('map')).toBe(true);
  expect(opened.visible.has('layout')).toBe(false);
  expect(
    graphDetail(layout, ui.expandAt * 0.9, opened.expanded).expanded.has('ui')
  ).toBe(true);
  expect(
    graphDetail(layout, ui.expandAt * 0.8, opened.expanded).expanded.has('ui')
  ).toBe(false);
  const detailed = graphDetail(layout, 1000, opened.expanded);
  expect(detailed.visible.size).toBe(graph.nodes.length);
  const nested = layout.nodes.find((node) => node.id === 'map')!;
  expect(graphFocus(layout, nested, detailed.expanded)?.id).toBe('map');
  expect(graphFocus(layout, nested, initial.expanded)).toBeUndefined();
  for (const node of layout.nodes.filter((node) => node.parent)) {
    const parent = layout.nodes.find(
      (candidate) => candidate.id === node.parent
    )!;
    expect(node.x - node.width / 2).toBeGreaterThan(
      parent.x - parent.width / 2
    );
    expect(node.x + node.width / 2).toBeLessThan(parent.x + parent.width / 2);
    expect(node.y - node.height / 2).toBeGreaterThan(
      parent.y - parent.height / 2
    );
    expect(node.y + node.height / 2).toBeLessThan(parent.y + parent.height / 2);
  }
  expect(JSON.stringify(layout)).toBe(geometry);
});

it('retains every relationship at its common scope, including cross-group, containment, and loop links', () => {
  const layout = graphDetailLayout(graph, 'TB');
  expect(layout.edges).toHaveLength(graph.edges.length);
  expect(layout.edges.find((edge) => edge.label === 'read')).toMatchObject({
    scope: undefined,
    from: 'ui',
    to: 'runtime',
    location: graph.edges[3].location,
  });
  expect(layout.edges.find((edge) => edge.label === 'position')).toMatchObject({
    scope: 'map',
    from: 'renderer',
    to: 'layout',
  });
  expect(layout.edges.find((edge) => edge.label === 'contains')).toMatchObject({
    scope: 'ui',
    from: 'ui',
    to: 'reader',
    points: [],
  });
  expect(layout.edges.find((edge) => edge.label === 'refresh')).toMatchObject({
    scope: 'ui',
    from: 'map',
    to: 'map',
  });
  expect(
    layout.nodes.every((node) => Number.isFinite(node.x) && node.width > 0)
  ).toBe(true);
});

it('shows sibling context for a visited detail and aggregates descendant files once', () => {
  const map = graphNeighborhood(graph, 'renderer');
  expect(map.nodes.map((node) => node.id)).toEqual(['renderer', 'layout']);
  expect(map.edges.map((edge) => edge.label)).toEqual(['position']);
  expect(graphPath(graph.nodes, 'renderer').map((node) => node.id)).toEqual([
    'ui',
    'map',
    'renderer',
  ]);
  const files = graph.nodes.map((node) => ({
    path: node.location.path,
    status: 'modified',
    added: 3,
    removed: 1,
  }));
  const withSharedFile = {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, files: ['ui.ts'] })),
  };
  const counts = graphChanges(withSharedFile, files);
  expect(counts.get('ui')).toMatchObject({ added: 15, removed: 5 });
  expect(counts.get('ui')!.files).toHaveLength(5);
  expect(counts.get('map')).toMatchObject({ added: 12, removed: 4 });
  expect(counts.get('map')!.files).toHaveLength(4);
});

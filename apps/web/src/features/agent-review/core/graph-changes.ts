import { graphPath } from './graph-hierarchy';
import type { CodeLocation, ReviewFile, ReviewGraph } from './model';

export type GraphFileSummary = Pick<
  ReviewFile,
  'path' | 'status' | 'added' | 'removed'
>;

export type GraphFile = GraphFileSummary & { location: CodeLocation };

export type ComponentChanges = {
  files: GraphFile[];
  added: number;
  removed: number;
};

/** Component membership is authored; displayed totals come only from this revision. */
export function graphChanges(graph: ReviewGraph, files: GraphFileSummary[]) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const members = new Map(
    graph.nodes.map((node) => [node.id, new Map<string, CodeLocation>()])
  );
  for (const node of graph.nodes) {
    for (const ancestor of graphPath(graph.nodes, node.id)) {
      const paths = members.get(ancestor.id)!;
      for (const path of [node.location.path, ...(node.files ?? [])]) {
        const file = byPath.get(path);
        if (!file) continue;
        if (!paths.has(path))
          paths.set(path, {
            path,
            side: file.status === 'deleted' ? 'old' : 'new',
            line: 1,
          });
        // Keep the component's own entry point; otherwise prefer a descendant's
        // authored code location over the first line of a bundled file.
        if (
          path === node.location.path &&
          (ancestor.id === node.id || path !== ancestor.location.path)
        )
          paths.set(path, node.location);
      }
    }
  }
  return new Map(
    graph.nodes.map((node) => {
      const files = [...members.get(node.id)!]
        .map(([path, location]) => ({ ...byPath.get(path)!, location }))
        .sort(
          (a, b) =>
            Number(b.path === node.location.path) -
              Number(a.path === node.location.path) ||
            a.path.localeCompare(b.path)
        );
      const totals = files.reduce(
        (sum, file) => ({
          added: sum.added + file.added,
          removed: sum.removed + file.removed,
        }),
        { added: 0, removed: 0 }
      );
      return [node.id, { files, ...totals } satisfies ComponentChanges];
    })
  );
}

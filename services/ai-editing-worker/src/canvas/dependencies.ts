import {
  type Bounds,
  type GraphicsDocument,
  worldBounds,
} from '@macro-inc/graphics';
import { presenceItemState } from '@macro-inc/graphics/loro';
import type { CanvasOp } from './schema';

export type CanvasDependencies = {
  reads: Set<string>;
  writes: Set<string>;
  regions: Bounds[];
  siblingParents: Set<string>;
};

export function overlaps(a: Bounds, b: Bounds): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** Actual command operands, containment, routing and occupied space determine conflicts. */
export function dependencies(
  before: GraphicsDocument,
  after: GraphicsDocument,
  ops: CanvasOp[]
): CanvasDependencies {
  const reads = new Set<string>();
  const writes = new Set<string>();
  const regions: Bounds[] = [];
  const siblingParents = new Set<string>();
  const ancestors = (document: GraphicsDocument, id: string) => {
    let item = document.items[id];
    while (item && item.type !== 'surface') {
      reads.add(item.id);
      item = document.items[item.placement.parentId];
    }
  };
  for (const id of new Set([
    ...Object.keys(before.items),
    ...Object.keys(after.items),
  ])) {
    if (
      presenceItemState(before.items[id]) !== presenceItemState(after.items[id])
    )
      writes.add(id);
  }
  for (const op of ops) {
    const ids = 'ids' in op ? op.ids : [op.id];
    for (const id of ids) {
      reads.add(id);
      ancestors(before, id);
      ancestors(after, id);
      // Structural/group transforms depend on every descendant, including references.
      for (const document of [before, after]) {
        for (const item of Object.values(document.items)) {
          let parent = item;
          while (parent && parent.type !== 'surface') {
            if (parent.id === id) {
              reads.add(item.id);
              break;
            }
            parent = document.items[parent.placement.parentId];
          }
        }
      }
    }
    if (op.kind === 'connect') {
      for (const end of [op.start, op.end]) {
        if (end.binding) ancestors(before, end.binding.targetId);
      }
    }
    if (op.kind === 'reparent') ancestors(before, op.parentId);
    if (['order', 'group', 'ungroup', 'reparent', 'delete'].includes(op.kind)) {
      // Tree placement/order depends on the relevant sibling lists.
      const parents = new Set(
        ids.map((id) => {
          const item = before.items[id];
          return item && item.type !== 'surface'
            ? item.placement.parentId
            : undefined;
        })
      );
      if (op.kind === 'reparent') parents.add(op.parentId);
      for (const parent of parents) if (parent) siblingParents.add(parent);
      for (const item of Object.values(before.items)) {
        if (item.type !== 'surface' && parents.has(item.placement.parentId))
          reads.add(item.id);
      }
    }
  }
  // Bound connectors depend on their target poses, including target ancestors.
  for (const document of [before, after]) {
    for (const item of Object.values(document.items)) {
      if (item.type !== 'connector') continue;
      const targets = [
        item.geometry.start.binding?.targetId,
        item.geometry.end.binding?.targetId,
      ];
      if (writes.has(item.id) || targets.some((id) => id && reads.has(id))) {
        reads.add(item.id);
        for (const id of targets) if (id) ancestors(document, id);
      }
    }
  }
  // A pure label/style edit needs no spatial reservation. New or moved geometry does.
  const boundsChanged = [...writes].some((id) => {
    const beforeItem = before.items[id],
      afterItem = after.items[id];
    if (!beforeItem || !afterItem) return true;
    return (
      JSON.stringify(worldBounds(before, id)) !==
      JSON.stringify(worldBounds(after, id))
    );
  });
  if (
    boundsChanged ||
    ops.some(
      (op) => !['text', 'mentionUser', 'style', 'order'].includes(op.kind)
    )
  ) {
    for (const id of writes) {
      for (const document of [before, after]) {
        const item = document.items[id];
        if (item && item.type !== 'surface' && item.type !== 'connector')
          regions.push(worldBounds(document, id));
      }
    }
  }
  return { reads, writes, regions, siblingParents };
}

export function conflicts(
  a: CanvasDependencies,
  b: CanvasDependencies
): boolean {
  return (
    [...a.writes].some((id) => b.reads.has(id) || b.writes.has(id)) ||
    [...b.writes].some((id) => a.reads.has(id)) ||
    a.regions.some((region) =>
      b.regions.some((other) => overlaps(region, other))
    )
  );
}

/** Frozen preconditions also detect a human creating something inside reserved space. */
export function dependencyState(
  document: GraphicsDocument,
  deps: CanvasDependencies
): string {
  const ids = new Set([...deps.reads, ...deps.writes]);
  for (const item of Object.values(document.items)) {
    let ancestor = item;
    while (ancestor && ancestor.type !== 'surface') {
      if (deps.reads.has(ancestor.id)) ids.add(item.id);
      ancestor = document.items[ancestor.placement.parentId];
    }
    if (
      item.type === 'connector' &&
      [
        item.geometry.start.binding?.targetId,
        item.geometry.end.binding?.targetId,
      ].some((id) => id && deps.reads.has(id))
    )
      ids.add(item.id);
    if (
      item.type !== 'surface' &&
      item.type !== 'connector' &&
      deps.regions.some((region) =>
        overlaps(region, worldBounds(document, item.id))
      )
    )
      ids.add(item.id);
  }
  const siblings = [...deps.siblingParents].sort().map((parent) => [
    parent,
    Object.values(document.items)
      .filter(
        (item) => item.type !== 'surface' && item.placement.parentId === parent
      )
      .map((item) =>
        item.type === 'surface' ? null : [item.id, item.placement.sortKey]
      )
      .sort(),
  ]);
  return JSON.stringify({
    items: [...ids]
      .sort()
      .map((id) => [id, presenceItemState(document.items[id])]),
    siblings,
  });
}

/** Conflicting batches wait; independent animations proceed. Commits have their own ACK queue. */
export class CanvasScheduler {
  private active: { deps: CanvasDependencies; done: Promise<void> }[] = [];

  async run<T>(deps: CanvasDependencies, run: () => Promise<T>): Promise<T> {
    const done = Promise.withResolvers<void>();
    const entry = { deps, done: done.promise };
    const blockers = this.active.filter((other) => conflicts(deps, other.deps));
    this.active.push(entry);
    try {
      await Promise.all(blockers.map((other) => other.done));
      return await run();
    } finally {
      this.active = this.active.filter((other) => other !== entry);
      done.resolve();
    }
  }
}

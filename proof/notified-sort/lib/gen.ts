// Read cases, generated from a seed. A case is who reads (which viewer,
// which world size), what (Home tab + facets, a random filter tree over the
// Soup targets, or the soup view's Home preset), how (page size, direction,
// grouping, foreign entities) and whether it re-reads from the network.

import type { ReadSpec, Source } from './browser.ts';
import type { Rng } from './rng.ts';
import type { World } from './world.ts';

export type ReadCase = {
  id: number;
  viewer: string;
  spec: ReadSpec;
  dims: Record<string, string>;
};

const HOME_TYPES = ['documents', 'tasks', 'email', 'channels', 'agents', 'folders', 'initiatives', 'github', 'calendar', 'none'];
const PAGE_SIZES = [1, 2, 3, 5, 8, 13, 37, 99, 100];

type Ctx = { world: World; viewer: string; rng: Rng; now: number };

const ids = (ctx: Ctx, kind?: string) =>
  ctx.world.entities.filter((e) => e.viewer === ctx.viewer && (!kind || e.kind === kind)).map((e) => e.id);

const someId = (ctx: Ctx, kind: string) => {
  const pool = ids(ctx, kind);
  // Mostly a real id, sometimes one that names nothing.
  return pool.length && ctx.rng.bool(0.85) ? ctx.rng.pick(pool) : ctx.rng.uuid();
};

const userIds = (ctx: Ctx) => [
  ...ctx.world.others.map((o) => o.userId),
  ...ctx.world.viewers.map((v) => v.userId),
];

const dateRange = (ctx: Ctx) => {
  const at = (days: number) => new Date(ctx.now - days * 86_400_000).toISOString();
  return ctx.rng.pick([
    { gte: at(ctx.rng.int(0, 30)) },
    { lt: at(ctx.rng.int(0, 400)) },
    { gt: at(ctx.rng.int(1, 60)), lte: at(0) },
  ]);
};

const bool = (ctx: Ctx) => ctx.rng.bool();

/** Leaf generators per target, over the fields Home and the soup view use. */
const LEAVES: Record<string, Record<string, (ctx: Ctx) => unknown>> = {
  df: {
    documentId: (c) => someId(c, 'document'),
    documentOwnerId: (c) => c.rng.pick(userIds(c)),
    documentSeen: bool,
    documentDone: bool,
    documentImportance: bool,
    documentCreatedAt: dateRange,
    documentUpdatedAt: dateRange,
  },
  calf: { calendarEventId: (c) => someId(c, 'calendar'), calendarEventSeen: bool, calendarEventDone: bool },
  ef: {
    threadId: (c) => someId(c, 'email'),
    emailSeen: bool,
    emailDone: bool,
    emailImportance: bool,
    emailShared: (c) => c.rng.pick(['exclude', 'only', 'include']),
    emailUpdatedAt: dateRange,
    emailSenderAddress: (c) => `sender${c.rng.int(0, 3)}@example.com`,
  },
  chanf: {
    channelId: (c) => someId(c, 'channel'),
    channelType: (c) => c.rng.pick(['public', 'private', 'direct_message', 'team']),
    channelSeen: bool,
    channelDone: bool,
    channelImportance: bool,
    channelIsParticipant: bool,
  },
  cthf: {
    channelThreadId: (c) => someId(c, 'thread'),
    channelThreadParticipantId: (c) => c.rng.pick(userIds(c)),
    channelThreadRootSenderId: (c) => c.rng.pick(userIds(c)),
    channelThreadSeen: bool,
    channelThreadDone: bool,
    channelThreadHasReplies: bool,
  },
  cf: { chatId: (c) => someId(c, 'chat'), chatSeen: bool, chatDone: bool, chatUpdatedAt: dateRange },
  pf: { folderId: (c) => someId(c, 'project'), folderSeen: bool, folderDone: bool, folderUpdatedAt: dateRange },
  if: { initiativeId: (c) => someId(c, 'initiative'), initiativeSeen: bool, initiativeDone: bool },
  fef: {
    foreignEntitySource: () => 'github_pull_request',
    foreignEntitySeen: bool,
    foreignEntityDone: bool,
  },
};

function tree(ctx: Ctx, target: string, depth: number): unknown {
  const leaves = LEAVES[target];
  const leaf = () => {
    const field = ctx.rng.pick(Object.keys(leaves));
    return { field, value: leaves[field](ctx) };
  };
  if (depth <= 0 || ctx.rng.bool(0.45)) return leaf();
  const op = ctx.rng.weighted([
    ['and', 4],
    ['or', 3],
    ['not', 1],
  ] as const);
  if (op === 'not') return { not: tree(ctx, target, depth - 1) };
  return { [op]: Array.from({ length: ctx.rng.int(2, 3) }, () => tree(ctx, target, depth - 1)) };
}

function depthOf(node: unknown): number {
  const n = node as Record<string, unknown>;
  if ('field' in n) return 0;
  if ('not' in n) return 1 + depthOf(n.not);
  const kids = (n.and ?? n.or) as unknown[];
  return 1 + Math.max(...kids.map(depthOf));
}

/** `now` anchors relative dates: the seed and `now` fix every case. */
export function generateReads(world: World, rng: Rng, count: number, startId = 0, now = Date.now()): ReadCase[] {
  const cases: ReadCase[] = [];
  const lanes = world.viewers.filter((v) => v.role === 'lane');
  const sizes = world.viewers.filter((v) => v.role === 'size');
  for (let i = 0; i < count; i++) {
    const viewer = rng.bool(0.7) || !sizes.length ? rng.pick(lanes) : rng.pick(sizes);
    const ctx: Ctx = { world, viewer: viewer.key, rng, now };
    const dims: Record<string, string> = {
      viewer: viewer.role === 'lane' ? 'lane' : `size:${viewer.size}`,
    };
    const sourceKind = rng.weighted([
      ['home', 5],
      ['filter', 4],
      ['preset', 1],
    ] as const);
    let source: Source;
    if (sourceKind === 'home') {
      const tab = rng.weighted([
        ['signal', 3],
        ['noise', 2],
      ] as const);
      const facets: Record<string, string[]> = {};
      const read = rng.weighted([
        [null, 2],
        ['unread', 1],
        ['read', 1],
      ] as const);
      if (read) facets.read = [read];
      const types = rng.bool(0.5) ? rng.subset(HOME_TYPES, 0.3) : [];
      if (types.length) facets.type = types;
      source = { kind: 'home', tab, facets, foreignEntities: rng.bool(0.7) };
      dims.tab = tab;
      dims.facetRead = read ?? 'all';
      dims.facetTypes = types.length === 0 ? '0' : types.length === 1 ? `1:${types[0]}` : '2+';
    } else if (sourceKind === 'filter') {
      const targets = rng.subset(Object.keys(LEAVES), 0.35);
      if (!targets.length) targets.push(rng.pick(Object.keys(LEAVES)));
      const filters: Record<string, unknown> = {};
      for (const target of targets) filters[target] = tree(ctx, target, rng.int(0, 3));
      const confined = rng.bool(0.6);
      source = { kind: 'filter', filters, confined, ...(rng.bool(0.4) ? { emailView: 'inbox' as const } : {}) };
      dims.targets = targets.length >= 3 ? '3+' : String(targets.length);
      for (const target of targets) dims[`target:${target}`] = 'yes';
      dims.depth = String(Math.max(...Object.values(filters).map(depthOf)));
      dims.confined = String(confined);
    } else {
      const tab = rng.pick(['signal', 'noise'] as const);
      source = { kind: 'preset', tab };
      dims.tab = tab;
    }
    dims.source = sourceKind;
    const limit = rng.pick(PAGE_SIZES);
    const direction = rng.bool(0.1) ? 'asc' : 'desc';
    const grouped = rng.weighted<unknown>([
      [undefined, 7],
      [{ type: 'entity_type' }, 1],
      [{ type: 'project' }, 1],
      [{ type: 'date' }, 1],
    ]);
    const spec: ReadSpec = {
      source,
      params: { limit, sort_method: 'notified_at', sort_direction: direction },
      groupBy: grouped,
      showForeign: rng.bool(0.8),
      fresh: rng.bool(0.2),
      maxPages: Math.min(60, Math.ceil(3000 / limit)),
    };
    dims.pageSize = String(limit);
    dims.direction = direction;
    dims.grouped = grouped ? (grouped as { type: string }).type : 'none';
    dims.showForeign = String(spec.showForeign);
    dims.fresh = String(spec.fresh);
    cases.push({ id: startId + i, viewer: viewer.key, spec, dims });
  }
  return cases;
}

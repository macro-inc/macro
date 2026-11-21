/**
 * Stateful sequences. One viewer keeps the moved readers mounted on main (old)
 * and on the branch (new) while a seeded sequence of writes runs against the
 * shared world. After every step:
 *
 * - truth: a third page (main's code, its query cache cleared) reads every
 *   reader cold, over REST: what a fresh load shows now;
 * - live: both mounted readers are polled until their caller view equals the
 *   truth, up to LIVE_MS. A reader main updates and the branch does not is a
 *   failure; one the branch updates and main does not is a difference to close;
 * - read-after-write: a step the viewer makes through the app's own mutation
 *   path runs on both pages at once (each side's own code), and the same
 *   convergence is held to RAW_MS;
 * - live data: the two mounted readers are compared in full (data and caller);
 * - reload: every RELOAD_EVERY steps (and at the end) both pages reload, the
 *   readers mount again, and old and new are compared in full and against the
 *   truth.
 *
 * Writes the viewer does not make go straight to the services as another
 * person or device would (lib/api.ts).
 */
import type { ApiUser } from './api';
import { AstGen } from './ast-gen';
import { cacheEventsBetween, ensurePage, loadProbe, rebootPage, registerPage, watchCacheErrors, type CacheEvent, type ExportedSpan, type UserSession } from './browser';
import { CALLERS } from './callers';
import { compareCaller, compareData, DATA_RULES, type Diff, PREVIEW_DROPS_NOTIFICATIONS } from './compare';
import { pageLoad, pendingRequests } from './inflight';
import { login } from './login';
import { oddName } from './names';
import { mount, resetQueries, settle, unmount } from './probe';
import type { Coverage, Rng } from './rng';
import type { Ent, UserKey, World } from './world';
import type { Browser, BrowserContext, Page } from 'playwright';

export const LIVE_MS = 8_000;
export const RAW_MS = 4_000;
const RELOAD_EVERY = 5;
const POLL_MS = 250;
/** How much longer a branch reader main beat is watched, to tell late from never. */
export const LATE_MS = 30_000;
const SETTLE = { timeoutMs: 40_000, stableMs: 500 };
/**
 * The longest a sequence step (write, comparisons and any reload) may run.
 * Reloads took up to 5 minutes on a loaded machine; a dev-server page that
 * never finishes loading a module leaves an in-page await pending forever,
 * and with it the lane. Past this the attempt is abandoned and run again on
 * freshly loaded pages.
 */
// DIFFTEST_STEP_DEADLINE_MS overrides it, to exercise the recovery in a short run.
const STEP_DEADLINE_MS = Number(process.env.DIFFTEST_STEP_DEADLINE_MS ?? 15 * 60_000);

export class StepTimeout extends Error {}

async function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StepTimeout(`${what} still running after ${Math.round(ms / 1000)} s`)), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** What each page showed when a step ran out of time: where it was and whether the probe answered. */
async function describePages(ctx: SeqContext): Promise<{ page: string; url: string; probe: string; pending: string[] }[]> {
  const pages: [string, Page][] = [['old', ctx.session.pages.old], ['new', ctx.session.pages.new], ['truth', ctx.truth]];
  return await Promise.all(
    pages.map(async ([name, page]) => {
      const probe = await Promise.race([
        page.evaluate(() => JSON.stringify({ probe: Boolean((window as any).__probe), ready: document.readyState, text: (document.body?.innerText ?? '').trim().length })).catch((e) => `evaluate failed: ${String(e).slice(0, 80)}`),
        Bun.sleep(10_000).then(() => 'evaluate did not answer in 10 s'),
      ]);
      return { page: name, url: page.url().replace(/^https?:\/\/[^/]+/, ''), probe, pending: pendingRequests(page) };
    })
  );
}

const PREVIEW_READERS = new Set(['qa.agentSessions', 'qa.initiatives', 'qa.skills', 'qa.snippets', 'crm.suggestions', 'slash.prs', 'email.recent']);

export type Reader = {
  key: string;
  caller: string;
  params: Record<string, unknown>;
  /** The caller main's page mounts (slash PRs: main's query with the oracle option). */
  oldCaller?: string;
};

export type SeqFailure = {
  seq: number;
  step: number;
  kind: string;
  reader?: string;
  params?: unknown;
  detail: string;
  diffs?: Diff[];
  trace?: string[];
  /** For a missed live update: when the branch did show it (null: never, within the tail). */
  lateMs?: number | null;
  /** The GraphQL cache errors each page logged around the step, relative to its write. */
  cache?: { new: string[]; old: string[] };
};

export type LiveTally = {
  both: number;
  neither: number;
  /** Main converged, the branch did not: a failure. */
  oldOnly: number;
  /** The branch converged, main did not: a difference. */
  newOnly: number;
  unaffected: number;
  latencyOld: number[];
  latencyNew: number[];
};

export type SeqResult = {
  sequences: number;
  steps: number;
  stepKinds: Record<string, number>;
  writeErrors: Record<string, number>;
  live: Record<string, LiveTally>;
  raw: Record<string, LiveTally>;
  reloads: number;
  comparisons: number;
  failures: SeqFailure[];
  /** Branch fresher than main, by reader and step kind: closed in the report. */
  newOnly: { seq: number; step: number; stepKind: string; reader: string; latencyMs: number }[];
  ruleHits: Record<string, number>;
  /** Pages put back in the app, and sequences the harness broke and ran again. */
  repairs: { where: string; error: string }[];
  /** Steps that ran past STEP_DEADLINE_MS, with what each page showed then. */
  hangs: { seq: number; step: number; kind: string; pages: { page: string; url: string; probe: string; pending: string[] }[] }[];
  aborted: { seq: number; attempt: number; error: string; droppedFailures: number }[];
  /**
   * A reader stale on both sides after an earlier step, which this step's own
   * refresh brought up to date on main only: by reader, step and field.
   */
  incidental: Record<string, { count: number; samples: { seq: number; step: number; params: unknown; diffs: Diff[]; trace: string[] }[] }>;
  /** App writes made on both pages at once that hit a state conflict and were applied again. */
  conflictRetries: number;
  /** Every field of the live readers against a cold read, after the live window. */
  liveData: { equal: number; bothStale: number; branchFresher: number; branchStaler: number; skipped: number; fresherBy: Record<string, number>; /** Where main lagged: reader and field path. */ fresherFields: Record<string, number> };
};

export function emptySeqResult(): SeqResult {
  return { sequences: 0, steps: 0, stepKinds: {}, writeErrors: {}, live: {}, raw: {}, reloads: 0, comparisons: 0, failures: [], newOnly: [], ruleHits: {}, incidental: {}, conflictRetries: 0, repairs: [], hangs: [], aborted: [], liveData: { equal: 0, bothStale: 0, branchFresher: 0, branchStaler: 0, skipped: 0, fresherBy: {}, fresherFields: {} } };
}

/**
 * A third page per viewer: main's app, read cold after every step. It has a
 * browser context of its own: a page on main's origin in the viewer's context
 * would share main's storage and broadcast channels, and its reads would
 * refresh main's mounted readers.
 */
export async function openTruthPage(
  b: Browser,
  email: string,
  origin: string,
  probePath: string,
  cookies?: Parameters<BrowserContext['addCookies']>[0]
): Promise<Page> {
  const context = await b.newContext({ viewport: { width: 1280, height: 900 } });
  context.setDefaultNavigationTimeout(180_000);
  context.setDefaultTimeout(180_000);
  if (cookies) await context.addCookies(cookies);
  const page = await context.newPage();
  await page.route('**/i/otlp/v1/traces', (route) => route.fulfill({ status: 200, body: '{}' }));
  watchCacheErrors(page);
  await login(page, origin, email);
  registerPage(page, { origin, email, probePath });
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.evaluate(async (p) => {
    await import(/* @vite-ignore */ p);
  }, probePath);
  return page;
}

// ---------------------------------------------------------------- projections

type Snap = { settled: boolean; data: unknown; caller: unknown; status: Record<string, unknown>; timedOut?: boolean };

/** The caller-level view the convergence and caller checks compare. */
function view(reader: Reader, snap: Snap): unknown {
  if (reader.caller === 'ast') {
    const d = snap.data as { entities?: { type?: string; id?: string; name?: string }[] } | null;
    return (d?.entities ?? []).map((e) => ({ type: e.type, id: e.id, name: e.name }));
  }
  return CALLERS[reader.caller].project(snap.caller);
}

const errorOf = (s: Snap) => (s.status?.error as string | null | undefined) ?? null;

function rulesFor(reader: Reader) {
  const preview =
    PREVIEW_READERS.has(reader.caller) || (reader.caller === 'ast' && (reader.params.options as Record<string, unknown> | undefined)?.ignoresNotifications);
  return preview ? [...DATA_RULES, PREVIEW_DROPS_NOTIFICATIONS] : DATA_RULES;
}

// ---------------------------------------------------------------- page helpers

async function mountAll(page: Page, readers: Reader[], side: 'old' | 'new' | 'truth') {
  await Promise.all(
    readers.map((r) => {
      const caller = side === 'new' ? r.caller : (r.oldCaller ?? r.caller);
      return mount(page, r.key, caller, r.params);
    })
  );
}

async function settleAll(page: Page, readers: Reader[]): Promise<Snap[]> {
  return await Promise.all(readers.map((r) => settle(page, r.key, SETTLE)));
}

async function snapAll(page: Page, readers: Reader[]): Promise<Snap[]> {
  return await page.evaluate(
    (keys) => keys.map((k) => (window as any).__probe.snapshot(k)),
    readers.map((r) => r.key)
  );
}

async function truthRead(truth: Page, readers: Reader[]): Promise<Snap[]> {
  await resetQueries(truth);
  await mountAll(truth, readers, 'truth');
  const snaps = await settleAll(truth, readers);
  await Promise.all(readers.map((r) => unmount(truth, r.key)));
  return snaps;
}

async function inPageWrite(page: Page, op: string, params: unknown): Promise<{ ok: boolean; error?: string }> {
  return await page.evaluate(
    async ({ op, params }) => {
      try {
        await (window as any).__probe.write(op, params);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error).slice(0, 300) };
      }
    },
    { op, params }
  );
}

// ---------------------------------------------------------------- the model

type ItemType = 'document' | 'chat' | 'project' | 'agent_session' | 'crm_company' | 'initiative';

const ITEM_TYPE: Partial<Record<Ent['kind'], ItemType>> = {
  md: 'document',
  task: 'document',
  snippet: 'document',
  skill: 'document',
  project: 'project',
  chat: 'chat',
  session: 'agent_session',
  crm: 'crm_company',
  initiative: 'initiative',
};

const PRIORITY = '00000001-0000-0000-0000-000000000003';
const PRIORITY_OPTIONS = ['00000001-0000-0000-0003-000000000001', '00000001-0000-0000-0003-000000000002', '00000001-0000-0000-0003-000000000003'];

/** Team property definition the option steps edit, made once per world. */
type StageDef = { id: string; options: string[] };

type Step = {
  kind: string;
  /** Made by the viewer through the app on both pages (read-after-write). */
  app?: { op: string; params: Record<string, unknown> };
  /** Made through the services by `actor`, as another person or device. */
  remote?: (users: Record<UserKey, ApiUser>) => Promise<void>;
  note: string;
};

export type SeqContext = {
  world: World;
  viewer: UserKey;
  session: UserSession;
  truth: Page;
  probePaths: { old: string; new: string };
  rng: Rng;
  coverage: Coverage;
  result: SeqResult;
  stage: StageDef;
  log: (line: string) => void;
  /** Steps per sequence. */
  length: number;
  /** Overrides step weights (a mutant campaign leans on the writes main shows live). */
  stepWeights?: Record<string, number>;
  /** Set by the mutant campaign: called before each reload. */
  beforeReload?: () => void;
};

const visibleTo = (viewer: UserKey, e: Ent) =>
  !e.deleted && (e.owner === viewer || e.access === 'team' || e.access === 'channel' || e.access === 'public');

/** Picks the next step from the current model; mutates the model as the step will. */
function nextStep(ctx: SeqContext, focus: Ent[], seq: number, i: number): Step {
  const { world, viewer, rng, coverage } = ctx;
  const ties: string[] = focus.map((e) => e.name);
  const name = (label: string) => oddName(rng, label, seq * 100 + i, ties, coverage, 120);
  const other: UserKey = viewer === 'owner' ? 'member' : 'owner';
  const own = (kinds: Ent['kind'][]) => focus.filter((e) => e.owner === viewer && kinds.includes(e.kind) && !e.deleted);
  const otherOwn = (kinds: Ent['kind'][]) => focus.filter((e) => e.owner === other && kinds.includes(e.kind) && !e.deleted);
  const docKinds: Ent['kind'][] = ['md', 'task', 'snippet', 'skill'];
  const weights: [number, string][] = [
    [10, 'create'],
    [10, 'rename.app'],
    [6, 'rename.remote'],
    [4, 'rename.session'],
    [4, 'rename.other'],
    [6, 'move.app'],
    [5, 'delete'],
    [6, 'share.app'],
    [5, 'share.remote'],
    [6, 'revoke'],
    [5, 'notify'],
    [6, 'markRead.app'],
    [4, 'participants'],
    [3, 'role'],
    [5, 'property'],
    [4, 'option'],
    [6, 'view.app'],
    [4, 'view.remote'],
  ];
  const kind = rng.weighted<string>(
    ctx.stepWeights ? weights.map(([w, k]) => [ctx.stepWeights?.[k] ?? 0, k] as [number, string]).filter(([w]) => w > 0) : weights
  );
  const fallback = (): Step => {
    const doc = rng.pick(focus.filter((e) => ITEM_TYPE[e.kind] === 'document' && !e.deleted).concat(own(docKinds)));
    return { kind: 'view.remote', note: `view ${doc?.id}`, remote: async (u) => void (await u[viewer].post(`/dss/history/document/${doc.id}`)) };
  };
  switch (kind) {
    case 'create': {
      const actor = rng.bool(0.6) ? viewer : other;
      const k = rng.pick(docKinds);
      const n = name(k);
      const shared = actor !== viewer || rng.bool(0.3);
      const ent: Ent = { kind: k, id: '', owner: actor, name: n, access: shared ? 'team' : 'private' };
      focus.push(ent);
      return {
        kind: 'create',
        note: `${actor} creates ${k} ${shared ? 'shared' : 'private'}`,
        remote: async (u) => {
          const user = u[actor];
          const path = { md: 'create_markdown', task: 'create_task', snippet: 'create_snippet', skill: 'create_skill' }[k as 'md'];
          const body =
            k === 'md'
              ? { documentName: n, markdown: 'synthetic', skipHistory: true }
              : k === 'task'
                ? { taskName: n, shareWithTeam: shared }
                : k === 'snippet'
                  ? { snippetName: n }
                  : { skillName: n, description: 'Use when testing sequences' };
          const { documentId } = await user.post<{ documentId: string }>(`/dss/documents/${path}`, body);
          ent.id = documentId;
          if (shared && k !== 'task') await user.put(`/dss/documents/${documentId}/team_share`, { shareWithTeam: true });
        },
      };
    }
    case 'rename.app': {
      const targets = own([...docKinds, 'chat', 'project']).filter((e) => e.id);
      if (!targets.length) return fallback();
      const t = rng.pick(targets);
      const n = name('Renamed');
      const oldName = t.name;
      t.name = n;
      const type = ITEM_TYPE[t.kind] as string;
      return { kind, note: `viewer renames ${t.kind} in app`, app: { op: 'rename', params: { id: t.id, type, name: n, oldName } } };
    }
    case 'rename.remote': {
      const targets = focus.filter((e) => docKinds.includes(e.kind) && e.id && !e.deleted && e.owner !== 'outsider');
      if (!targets.length) return fallback();
      const t = rng.pick(targets);
      const n = name('Edited');
      t.name = n;
      return { kind, note: `${t.owner} renames ${t.kind} elsewhere`, remote: async (u) => void (await u[t.owner].patch(`/dss/documents/${t.id}`, { documentName: n })) };
    }
    case 'rename.session': {
      const targets = own(['session']);
      if (!targets.length) return fallback();
      const t = rng.pick(targets);
      const n = oddName(rng, 'Session', seq * 100 + i, ties, coverage, 100);
      t.name = n;
      return { kind, note: 'viewer renames a session in app', app: { op: 'renameSession', params: { id: t.id, name: n } } };
    }
    case 'rename.other': {
      // CRM companies, initiatives and chats, renamed elsewhere.
      const targets = focus.filter((e) => (e.kind === 'crm' || e.kind === 'initiative' || e.kind === 'chat') && !e.deleted);
      if (!targets.length) return fallback();
      const t = rng.pick(targets);
      const n = name('Renamed');
      t.name = n;
      return {
        kind,
        note: `rename ${t.kind} elsewhere`,
        remote: async (u) => {
          if (t.kind === 'crm') await u.owner.put(`/dss/crm/companies/${t.id}/name`, { name: n });
          else if (t.kind === 'chat') await u[t.owner].patch(`/cognition/chats/${t.id}`, { name: n });
          else
            await u[t.owner].graphql('mutation U($id: ID!, $input: UpdateInitiativeInput!){ updateInitiative(initiativeId:$id, input:$input){ id } }', {
              id: t.id,
              input: { name: [...n].slice(0, 100).join('') },
            });
        },
      };
    }
    case 'move.app': {
      const targets = own(docKinds).filter((e) => e.id);
      const projects = world.entities.filter((e) => e.kind === 'project' && e.owner === viewer && !e.deleted);
      if (!targets.length || !projects.length) return fallback();
      const t = rng.pick(targets);
      const projectId = t.projectId && rng.bool(0.4) ? null : rng.pick(projects).id;
      t.projectId = projectId ?? undefined;
      return { kind, note: `viewer moves a document ${projectId ? 'into a project' : 'out of its project'}`, app: { op: 'move', params: { type: 'DOCUMENT', id: t.id, projectId } } };
    }
    case 'delete': {
      const targets = focus.filter((e) => docKinds.includes(e.kind) && e.id && !e.deleted && (e.owner === 'owner' || e.owner === 'member'));
      if (targets.length < 2) return fallback();
      const t = rng.pick(targets);
      t.deleted = true;
      coverage.hit('seq-delete', `${t.owner === viewer ? 'own' : 'other'}:${t.access}`);
      return { kind, note: `${t.owner} deletes a ${t.kind}`, remote: async (u) => void (await u[t.owner].del(`/dss/documents/${t.id}`)) };
    }
    case 'share.app': {
      const targets = own(docKinds).filter((e) => e.id);
      if (!targets.length) return fallback();
      const t = rng.pick(targets);
      const how = rng.pick(['team', 'public', 'channel'] as const);
      t.access = how;
      const request =
        how === 'team'
          ? { teamShareAccessLevel: 'view' }
          : how === 'public'
            ? { linkShare: 'PUBLIC', linkShareAccessLevel: 'view' }
            : { channelSharePermissions: [{ channelId: world.channelId, operation: 'add', accessLevel: 'view' }] };
      coverage.hit('seq-share', how);
      return { kind, note: `viewer shares a document (${how}) in app`, app: { op: 'share', params: { itemType: 'document', id: t.id, request } } };
    }
    case 'share.remote': {
      const targets = otherOwn(docKinds).filter((e) => e.id);
      if (!targets.length) return fallback();
      const t = rng.pick(targets);
      const how = rng.pick(['team', 'channel'] as const);
      t.access = how;
      coverage.hit('seq-share', `remote:${how}`);
      return {
        kind,
        note: `${t.owner} shares a ${t.kind} with the ${how}`,
        remote: async (u) => {
          if (how === 'team') await u[t.owner].put(`/dss/documents/${t.id}/team_share`, { shareWithTeam: true });
          else
            await u[t.owner].patch(`/dss/documents/${t.id}`, {
              sharePermission: { channelSharePermissions: [{ channelId: world.channelId, operation: 'add', accessLevel: 'view' }] },
            });
        },
      };
    }
    case 'revoke': {
      const targets = focus.filter((e) => docKinds.includes(e.kind) && e.id && !e.deleted && e.access !== 'private' && (e.owner === 'owner' || e.owner === 'member'));
      if (!targets.length) return fallback();
      const t = rng.pick(targets);
      const was = t.access;
      t.access = 'revoked';
      coverage.hit('seq-revoke', `${t.owner === viewer ? 'own' : 'other'}:${was}`);
      if (t.owner === viewer)
        return {
          kind: 'revoke.app',
          note: `viewer revokes ${was} sharing in app`,
          app: {
            op: 'share',
            params: {
              itemType: 'document',
              id: t.id,
              request:
                was === 'channel'
                  ? { channelSharePermissions: [{ channelId: world.channelId, operation: 'remove' }] }
                  : was === 'public'
                    ? { linkShareAccessLevel: null }
                    : { teamShareAccessLevel: null },
            },
          },
        };
      return {
        kind: 'revoke.remote',
        note: `${t.owner} revokes ${was} sharing`,
        remote: async (u) => {
          if (was === 'channel')
            await u[t.owner].patch(`/dss/documents/${t.id}`, {
              sharePermission: { channelSharePermissions: [{ channelId: world.channelId, operation: 'remove' }] },
            });
          else await u[t.owner].put(`/dss/documents/${t.id}/team_share`, { shareWithTeam: false });
        },
      };
    }
    case 'notify': {
      coverage.hit('seq-notify', 'channel-message');
      return {
        kind,
        note: `${other} posts in the shared channel`,
        remote: async (u) => void (await u[other].post(`/dss/messages/channel/${world.channelId}`, { content: `synthetic ${seq}.${i}` })),
      };
    }
    case 'markRead.app': {
      const entities = [{ type: 'channel', id: world.channelId }];
      const docs = focus.filter((e) => docKinds.includes(e.kind) && e.id && !e.deleted && visibleTo(viewer, e));
      if (docs.length && rng.bool(0.5)) entities.push({ type: 'document', id: rng.pick(docs).id });
      const operation = rng.pick(['MARK_SEEN', 'MARK_DONE']);
      coverage.hit('seq-markRead', operation);
      return { kind, note: `viewer marks ${entities.length} entities ${operation}`, app: { op: 'markRead', params: { entities, operation } } };
    }
    case 'participants': {
      const add = rng.bool(0.5);
      coverage.hit('seq-participants', add ? 'add' : 'remove');
      return {
        kind,
        note: `owner ${add ? 'adds' : 'removes'} the member ${add ? 'to' : 'from'} the channel`,
        remote: async (u) => {
          const r = await u.owner.raw(`/dss/channels/${world.channelId}/participants`, {
            method: add ? 'POST' : 'DELETE',
            body: JSON.stringify({ participants: [u.member.id] }),
          });
          if (!r.ok && r.status !== 409 && r.status !== 404) throw new Error(`participants ${r.status}`);
        },
      };
    }
    case 'role': {
      const role = rng.pick(['admin', 'member'] as const);
      coverage.hit('seq-role', role);
      return {
        kind,
        note: `owner makes the member ${role}`,
        remote: async (u) => void (await u.owner.patch('/auth/team', { user_role_updates: [{ team_user_id: u.member.id, role }] })),
      };
    }
    case 'property': {
      const tasks = focus.filter((e) => e.kind === 'task' && e.id && !e.deleted && (e.owner === 'owner' || e.owner === 'member'));
      if (!tasks.length) return fallback();
      const t = rng.pick(tasks);
      const clear = rng.bool(0.2);
      const option = rng.pick(PRIORITY_OPTIONS);
      coverage.hit('seq-property', clear ? 'clear' : 'set');
      return {
        kind,
        note: `${t.owner} ${clear ? 'clears' : 'sets'} a task's priority`,
        remote: async (u) => {
          const r = await u[t.owner].raw(`/dss/properties/entities/DOCUMENT/${t.id}/${PRIORITY}`, {
            method: 'PUT',
            body: JSON.stringify({ value: clear ? null : { type: 'select_option', option_id: option } }),
          });
          if (!r.ok) throw new Error(`property ${r.status} ${(await r.text()).slice(0, 120)}`);
        },
      };
    }
    case 'option': {
      const tasks = focus.filter((e) => e.kind === 'task' && e.id && !e.deleted && (e.owner === 'owner' || e.owner === 'member'));
      const what = rng.weighted<string>([
        [3, 'add'],
        [3, 'assign'],
        [2, 'delete'],
      ]);
      const stage = ctx.stage;
      coverage.hit('seq-option', what);
      if (what === 'add' || !stage.options.length)
        return {
          kind: 'option.add',
          note: 'owner adds an option to a team property',
          remote: async (u) => {
            const o = await u.owner.post<{ id: string }>(`/dss/properties/definitions/${stage.id}/options`, {
              type: 'select_string',
              option: { value: name('Stage').slice(0, 60), display_order: stage.options.length },
            });
            stage.options.push(o.id);
          },
        };
      if (what === 'assign' && tasks.length) {
        const t = rng.pick(tasks);
        const option = rng.pick(stage.options);
        return {
          kind: 'option.assign',
          note: `${t.owner} sets a team property option on a task`,
          remote: async (u) => {
            const r = await u[t.owner].raw(`/dss/properties/entities/DOCUMENT/${t.id}/${stage.id}`, {
              method: 'PUT',
              body: JSON.stringify({ value: { type: 'select_option', option_id: option } }),
            });
            if (!r.ok) throw new Error(`option assign ${r.status} ${(await r.text()).slice(0, 120)}`);
          },
        };
      }
      const option = rng.pick(stage.options);
      stage.options = stage.options.filter((o) => o !== option);
      return {
        kind: 'option.delete',
        note: 'owner deletes a team property option (and its assignments)',
        remote: async (u) => void (await u.owner.del(`/dss/properties/definitions/${stage.id}/options/${option}`)),
      };
    }
    case 'view.app': {
      const targets = focus.filter((e) => ITEM_TYPE[e.kind] && e.id && !e.deleted && visibleTo(viewer, e) && e.kind !== 'crm' && e.kind !== 'initiative');
      if (!targets.length) return fallback();
      const t = rng.pick(targets);
      coverage.hit('seq-view', t.kind);
      return { kind, note: `viewer opens a ${t.kind} (history)`, app: { op: 'view', params: { itemType: ITEM_TYPE[t.kind], id: t.id } } };
    }
    default: {
      const targets = focus.filter((e) => ITEM_TYPE[e.kind] && e.id && !e.deleted && visibleTo(viewer, e));
      if (!targets.length) return fallback();
      const t = rng.pick(targets);
      coverage.hit('seq-view', `remote:${t.kind}`);
      return {
        kind: 'view.remote',
        note: `viewer opens a ${t.kind} on another device`,
        remote: async (u) => void (await u[viewer].post(`/dss/history/${ITEM_TYPE[t.kind]}/${t.id}`)),
      };
    }
  }
}

// ---------------------------------------------------------------- one sequence

function tally(map: Record<string, LiveTally>, reader: string): LiveTally {
  return (map[reader] ??= { both: 0, neither: 0, oldOnly: 0, newOnly: 0, unaffected: 0, latencyOld: [], latencyNew: [] });
}

let aaControl = false;
/** Main's app on both sides: every reader mounts the same caller on each. */
export function setAaControl() {
  aaControl = true;
}

function readersFor(ctx: SeqContext, focus: Ent[], seq: number): Reader[] {
  const { world, rng, coverage, viewer } = ctx;
  const k = (name: string) => `s${seq}${name.replace(/\W/g, '')}${Math.random().toString(36).slice(2, 6)}`;
  const figDoc = world.entities.find((e) => e.kind === 'md' && e.owner === viewer && !e.deleted) ?? focus[0];
  const readers: Reader[] = [
    ...['qa.agentSessions', 'qa.initiatives', 'qa.skills', 'qa.snippets', 'recentlyViewed', 'crm.suggestions'].map((caller) => ({ key: k(caller), caller, params: {} })),
    { key: k('chats'), caller: 'home.recentChats', params: { limit: 12 } },
    { key: k('email'), caller: 'email.recent', params: { term: '' } },
    { key: k('fig'), caller: 'fig.libraries', params: { documentId: figDoc?.id } },
    aaControl ? { key: k('slash'), caller: 'slash.prs', params: {} } : { key: k('slash'), caller: 'slash.prs', oldCaller: 'slash.prsOracle', params: {} },
  ];
  const docs = focus.filter((e) => ['md', 'task', 'snippet', 'skill'].includes(e.kind) && e.id);
  for (const d of rng.sample(docs, 2)) readers.push({ key: k('hover'), caller: 'hover', params: { documentId: d.id } });
  const tasks = world.entities.filter((e) => e.kind === 'task');
  readers.push({ key: k('dup'), caller: 'taskDup', params: { ids: rng.sample(tasks, rng.int(1, 8)).map((t) => t.id), focus: true } });
  // Generic Soup lists through the translator, one page each.
  const gen = new AstGen(rng, world, coverage);
  for (let i = 0; i < 3; i++) {
    const c = gen.generate();
    readers.push({ key: k('ast'), caller: 'ast', params: { args: c.args, options: c.options, pages: 1 } });
  }
  return readers;
}

/** The task-duplicate reader follows the sequence's tasks. */
function refreshFocusReaders(readers: Reader[], focus: Ent[]) {
  const tasks = focus.filter((e) => e.kind === 'task' && e.id).map((e) => e.id);
  for (const r of readers) if (r.caller === 'taskDup' && tasks.length) r.params = { ...r.params, ids: [...new Set([...(r.params.ids as string[]), ...tasks])].slice(-12) };
}

async function compareSides(ctx: SeqContext, readers: Reader[], o: Snap[], n: Snap[], truth: Snap[] | undefined, seq: number, step: number, phase: string) {
  readers.forEach((r, i) => {
    const fail = (kind: string, detail: string, diffs?: Diff[]) =>
      ctx.result.failures.push({ seq, step, kind: `${phase}:${kind}`, reader: r.caller, params: r.params, detail, ...(diffs && { diffs }) });
    ctx.result.comparisons++;
    if (o[i].timedOut || n[i].timedOut) return fail('timeout', `old ${o[i].timedOut} new ${n[i].timedOut}`);
    const oe = errorOf(o[i]);
    const ne = errorOf(n[i]);
    if (Boolean(oe) !== Boolean(ne)) return fail('status', `error old ${oe} new ${ne}`);
    if (oe && ne) return;
    const data = compareData(o[i].data, n[i].data, rulesFor(r));
    for (const [id, c] of Object.entries(data.ruleHits)) ctx.result.ruleHits[id] = (ctx.result.ruleHits[id] ?? 0) + c;
    if (!data.equal) fail('data', `${data.diffs.length} data diffs`, data.diffs);
    const cv = compareCaller(view(r, o[i]), view(r, n[i]));
    if (!cv.equal) fail('caller', `${cv.diffs.length} caller diffs`, cv.diffs);
    if (truth && !truth[i].timedOut && !errorOf(truth[i])) {
      const tv = compareCaller(view(r, truth[i]), view(r, n[i]));
      if (!tv.equal) fail('vs-truth', `branch differs from a cold read: ${tv.diffs.length} diffs`, tv.diffs);
    }
  });
}

/**
 * Every field of the live readers, after the live window: each side against
 * the cold read. Main's own staleness is not the branch's: a field is a
 * failure only where the branch is stale (or wrong) and main is not.
 */
function liveData(ctx: SeqContext, readers: Reader[], o: Snap[], n: Snap[], truth: Snap[], prevTruth: Snap[], seq: number, step: number, stepKind: string, trace: string[], t0: number) {
  const pages = ctx.session.pages;
  const cache = () => ({ new: compactEvents(cacheEventsBetween(pages.new, t0 - 10_000, Date.now()), t0), old: compactEvents(cacheEventsBetween(pages.old, t0 - 10_000, Date.now()), t0) });
  readers.forEach((r, i) => {
    if (!o[i].settled || !n[i].settled || truth[i].timedOut || errorOf(truth[i]) || errorOf(o[i]) || errorOf(n[i])) {
      ctx.result.liveData.skipped++;
      return;
    }
    ctx.result.comparisons++;
    const rules = rulesFor(r);
    const dn = compareData(truth[i].data, n[i].data, rules, 200);
    const dold = compareData(truth[i].data, o[i].data, rules, 200);
    for (const [id, c] of Object.entries(dn.ruleHits)) ctx.result.ruleHits[id] = (ctx.result.ruleHits[id] ?? 0) + c;
    const key = (d: Diff) => `${d.path}=${JSON.stringify(d.new)}`;
    const oldStale = new Set(dold.diffs.map((d) => d.path));
    const onlyNew = dn.diffs.filter((d) => !oldStale.has(d.path));
    const onlyOld = dold.diffs.filter((d) => !dn.diffs.some((x) => x.path === d.path));
    if (dn.equal && dold.equal) ctx.result.liveData.equal++;
    else if (!onlyNew.length && !onlyOld.length) ctx.result.liveData.bothStale++;
    if (onlyOld.length && !onlyNew.length) {
      ctx.result.liveData.branchFresher++;
      const k = `${r.caller}:${stepKind}`;
      ctx.result.liveData.fresherBy[k] = (ctx.result.liveData.fresherBy[k] ?? 0) + 1;
      for (const d of onlyOld) {
        const f = `${r.caller}|${d.path.replace(/\[[^\]]*\]/g, '[]')}`;
        ctx.result.liveData.fresherFields[f] = (ctx.result.liveData.fresherFields[f] ?? 0) + 1;
      }
    }
    if (onlyNew.length) {
      ctx.result.liveData.branchStaler++;
      // Fields this step changed (in the cold read) vs. fields an earlier step changed.
      const p = prevTruth[i];
      const changedNow = new Set(
        p && !p.timedOut && !errorOf(p) ? compareData(p.data, truth[i].data, rules, 10_000).diffs.map((d) => d.path) : []
      );
      const direct = onlyNew.filter((d) => changedNow.has(d.path));
      const earlier = onlyNew.filter((d) => !changedNow.has(d.path));
      if (direct.length)
        ctx.result.failures.push({
          seq,
          step,
          kind: 'live:missed-field',
          reader: r.caller,
          params: r.params,
          detail: `${stepKind}: main shows this step's change in ${direct.length} fields, the branch does not (${direct.slice(0, 3).map(key).join('; ').slice(0, 300)})`,
          diffs: direct.slice(0, 10),
          trace: [...trace],
          cache: cache(),
        });
      if (earlier.length) {
        const k = `${r.caller}|${stepKind}|${earlier.map((d) => d.path.replace(/\[[^\]]*\]/g, '[]')).sort()[0]}`;
        const g = (ctx.result.incidental[k] ??= { count: 0, samples: [] });
        g.count++;
        if (g.samples.length < 3) g.samples.push({ seq, step, params: r.params, diffs: earlier.slice(0, 5), trace: [...trace] });
      }
    }
  });
}

/** Cache errors relative to the step's write. */
function compactEvents(events: CacheEvent[], t0: number) {
  return events.map((e) => `${e.at - t0} ms: ${e.text.replace(/\s+\{.*$/, '').slice(0, 100)}`);
}

/**
 * Polls both sides' mounted readers until each equals the truth or `bound`
 * runs out; tallies each reader the step changed.
 */
async function converge(ctx: SeqContext, readers: Reader[], truth: Snap[], prevTruth: (string | undefined)[], bound: number, map: Record<string, LiveTally>, stepKind: string, seq: number, step: number, t0: number) {
  const { session } = ctx;
  const tv = truth.map((t, i) => (t.timedOut || errorOf(t) ? undefined : JSON.stringify(view(readers[i], t))));
  const at: { old: (number | undefined)[]; new: (number | undefined)[] } = { old: readers.map(() => undefined), new: readers.map(() => undefined) };
  const affected = readers.map((_, i) => tv[i] !== undefined && prevTruth[i] !== undefined && prevTruth[i] !== tv[i]);
  // The branch's last snapshot, for the caller diff a missed update leaves.
  let lastNew: Snap[] = [];
  for (;;) {
    const elapsed = Date.now() - t0;
    const [o, n] = await Promise.all([snapAll(session.pages.old, readers), snapAll(session.pages.new, readers)]);
    lastNew = n;
    readers.forEach((r, i) => {
      if (!affected[i]) return;
      if (at.old[i] === undefined && o[i].settled && JSON.stringify(view(r, o[i])) === tv[i]) at.old[i] = elapsed;
      if (at.new[i] === undefined && n[i].settled && JSON.stringify(view(r, n[i])) === tv[i]) at.new[i] = elapsed;
    });
    const pending = readers.some((_, i) => affected[i] && (at.old[i] === undefined || at.new[i] === undefined));
    if (!pending || elapsed >= bound) break;
    await Bun.sleep(POLL_MS);
  }
  // A reader main updated within the bound and the branch did not: keep
  // watching the branch, so the result says late (and by how much) or never.
  const behind = readers.map((_, i) => affected[i] && at.old[i] !== undefined && at.new[i] === undefined);
  const lateAt: (number | undefined)[] = readers.map(() => undefined);
  while (behind.some((b, i) => b && lateAt[i] === undefined) && Date.now() - t0 < bound + LATE_MS) {
    await Bun.sleep(POLL_MS * 2);
    const n = await snapAll(session.pages.new, readers);
    lastNew = n;
    const elapsed = Date.now() - t0;
    readers.forEach((r, i) => {
      if (behind[i] && lateAt[i] === undefined && n[i].settled && JSON.stringify(view(r, n[i])) === tv[i]) lateAt[i] = elapsed;
    });
  }
  const cache = { new: compactEvents(cacheEventsBetween(session.pages.new, t0 - 10_000, Date.now()), t0), old: compactEvents(cacheEventsBetween(session.pages.old, t0 - 10_000, Date.now()), t0) };
  readers.forEach((r, i) => {
    const t = tally(map, r.caller);
    if (!affected[i]) {
      t.unaffected++;
      return;
    }
    const o = at.old[i];
    const n = at.new[i];
    if (o !== undefined) t.latencyOld.push(o);
    if (n !== undefined) t.latencyNew.push(n);
    if (o !== undefined && n !== undefined) t.both++;
    else if (o === undefined && n === undefined) t.neither++;
    else if (o !== undefined) {
      t.oldOnly++;
      const late = lateAt[i];
      ctx.result.failures.push({
        seq,
        step,
        kind: `${map === ctx.result.raw ? 'raw' : 'live'}:missed-update`,
        reader: r.caller,
        params: r.params,
        detail: `${stepKind}: main showed the change after ${o} ms, the branch not within ${bound} ms; ${late === undefined ? `not within ${bound + LATE_MS} ms either` : `it did at ${late} ms`}`,
        lateMs: late ?? null,
        cache,
        // The apps' own list-refresh spans in the window, start offset and duration.
        phases: {
          old: phaseSpans(session.spans.old, t0),
          new: phaseSpans(session.spans.new, t0),
        },
        // What the branch still showed against the cold read when the watch ended.
        ...(late === undefined && lastNew[i] && { diffs: compareCaller(JSON.parse(tv[i] as string), view(r, lastNew[i])).diffs.slice(0, 8) }),
      });
    } else {
      t.newOnly++;
      ctx.result.newOnly.push({ seq, step, stepKind, reader: r.caller, latencyMs: n as number });
    }
  });
}

function phaseSpans(spans: ExportedSpan[], t0: number): string[] {
  return spans
    .filter((s) => s.start !== undefined && s.start >= t0 - 100 && /^(agent_session|soup|graphql_cache|entity)\./.test(s.name))
    .slice(0, 16)
    .map((s) => `${s.name} +${(s.start as number) - t0}ms ${s.ms}ms`);
}

const truthViews = (readers: Reader[], truth: Snap[]) =>
  truth.map((t, i) => (t.timedOut || errorOf(t) ? undefined : JSON.stringify(view(readers[i], t))));

async function reloadBoth(ctx: SeqContext, readers: Reader[]) {
  const { session } = ctx;
  ctx.beforeReload?.();
  await Promise.all(
    (['old', 'new'] as const).map(async (side) => {
      try {
        await pageLoad(async () => {
          await session.pages[side].reload({ waitUntil: 'domcontentloaded' });
          await loadProbe(session, side, ctx.probePaths[side]);
        });
      } catch (error) {
        ctx.result.repairs.push({ where: `reload ${side}`, error: String(error).slice(0, 200) });
      }
      if (await ensurePage(session.pages[side])) ctx.result.repairs.push({ where: `reload ${side}`, error: 'page left the app' });
    })
  );
  await Promise.all([mountAll(session.pages.old, readers, 'old'), mountAll(session.pages.new, readers, 'new')]);
  ctx.result.reloads++;
}

export async function runSequence(ctx: SeqContext, seq: number) {
  const { session, world, rng, result, viewer } = ctx;
  const trace: string[] = [];
  // The sequence's focus: entities it reads and writes, plus what it creates.
  const pool = world.entities.filter((e) => !e.deleted && e.kind !== 'pr' && e.kind !== 'channel' && (e.owner === 'owner' || e.owner === 'member'));
  const focus: Ent[] = [
    ...rng.sample(pool.filter((e) => ['md', 'task', 'snippet', 'skill'].includes(e.kind)), 5),
    ...rng.sample(pool.filter((e) => e.kind === 'task'), 2),
    ...rng.sample(pool.filter((e) => e.kind === 'chat' || e.kind === 'session' || e.kind === 'project'), 3),
    ...rng.sample(pool.filter((e) => e.kind === 'crm' || e.kind === 'initiative'), 2),
  ];
  const readers = readersFor(ctx, focus, seq);
  const hung = async (step: number, kind: string, error: unknown) => {
    if (error instanceof StepTimeout) {
      const pages = await describePages(ctx);
      result.hangs.push({ seq, step, kind, pages });
      ctx.log(`seq ${seq} step ${step} ${kind} ran out of time: ${JSON.stringify(pages).slice(0, 600)}`);
    }
    throw error;
  };
  const initial = await withDeadline(
    (async () => {
      await Promise.all([resetQueries(session.pages.old), resetQueries(session.pages.new)]);
      await Promise.all([mountAll(session.pages.old, readers, 'old'), mountAll(session.pages.new, readers, 'new')]);
      const [, , snaps] = await Promise.all([settleAll(session.pages.old, readers), settleAll(session.pages.new, readers), truthRead(ctx.truth, readers)]);
      return snaps;
    })(),
    STEP_DEADLINE_MS,
    `seq ${seq} setup`
  ).catch((error) => hung(-1, 'setup', error));
  let prevTruthSnaps = initial;
  let prevTruth = truthViews(readers, initial);

  for (let i = 0; i < ctx.length; i++) {
    const step = nextStep(ctx, focus, seq, i);
    trace.push(`${i}: ${step.note}`);
    result.stepKinds[step.kind] = (result.stepKinds[step.kind] ?? 0) + 1;
    ctx.coverage.hit('seq-step', step.kind);
    const t0 = Date.now();
    await withDeadline((async () => {
    let wrote = true;
    try {
      if (step.app) {
        const app = step.app;
        const write = async (page: Page) => {
          const r = await inPageWrite(page, app.op, app.params);
          if (r.ok || !r.error?.includes('CONFLICT')) return r;
          result.conflictRetries++;
          return await inPageWrite(page, app.op, app.params);
        };
        const [o, n] = await Promise.all([write(session.pages.old), write(session.pages.new)]);
        if (o.ok !== n.ok) result.failures.push({ seq, step: i, kind: 'write:status', detail: `${step.kind}: main ${o.ok ? 'ok' : o.error}, branch ${n.ok ? 'ok' : n.error}`, trace: [...trace] });
        if (!o.ok && !n.ok) throw new Error(o.error);
      } else await step.remote?.(world.users);
    } catch (error) {
      wrote = false;
      const key = `${step.kind}: ${String(error).replace(/[0-9a-f-]{36}/g, '<id>').slice(0, 120)}`;
      result.writeErrors[key] = (result.writeErrors[key] ?? 0) + 1;
    }
    result.steps++;
    if (wrote) {
      const truth = await truthRead(ctx.truth, readers);
      await converge(ctx, readers, truth, prevTruth, step.app ? RAW_MS : LIVE_MS, step.app ? result.raw : result.live, step.kind, seq, i, t0);
      const [o, n] = await Promise.all([snapAll(session.pages.old, readers), snapAll(session.pages.new, readers)]);
      liveData(ctx, readers, o, n, truth, prevTruthSnaps, seq, i, step.kind, trace, t0);
      prevTruth = truthViews(readers, truth);
      prevTruthSnaps = truth;
    }
    const last = i === ctx.length - 1;
    if ((i + 1) % RELOAD_EVERY === 0 || last) {
      refreshFocusReaders(readers, focus);
      for (const r of readers) {
        await Promise.all([unmount(session.pages.old, r.key), unmount(session.pages.new, r.key)]);
      }
      await reloadBoth(ctx, readers);
      const [o, n, truth] = await Promise.all([settleAll(session.pages.old, readers), settleAll(session.pages.new, readers), truthRead(ctx.truth, readers)]);
      await compareSides(ctx, readers, o, n, truth, seq, i, 'reload');
      prevTruth = truthViews(readers, truth);
      prevTruthSnaps = truth;
    }
    })(), STEP_DEADLINE_MS, `seq ${seq} step ${i} ${step.kind}`).catch((error) => hung(i, step.kind, error));
    // One line per step, so a slow or stuck lane shows where it is.
    ctx.log(`seq ${seq} step ${i} ${step.kind}: ${Date.now() - t0} ms`);
  }
  for (const f of result.failures) if (f.seq === seq && !f.trace) f.trace = trace;
  await Promise.all(readers.flatMap((r) => [unmount(session.pages.old, r.key), unmount(session.pages.new, r.key)]));
  result.sequences++;
}

/** The team property definition option steps edit. */
export async function ensureStageDefinition(owner: ApiUser, tag: string): Promise<StageDef> {
  type Created = {
    id?: string;
    definition?: { id: string };
    property_options?: { id: string }[];
    propertyOptions?: { id: string }[];
  };
  const created = await owner.post<Created>('/dss/properties/definitions', {
    display_name: `Difftest stage ${tag}`,
    scope: 'team',
    data_type: {
      type: 'select_string',
      multi: false,
      options: ['Lead', 'Trial', 'Won'].map((value, display_order) => ({ value, display_order })),
    },
  });
  const id = created.definition?.id ?? created.id;
  if (!id) throw new Error(`property definition response ${JSON.stringify(created).slice(0, 200)}`);
  const listed = await owner.get<{ id: string }[]>(`/dss/properties/definitions/${id}/options`);
  return { id, options: listed.map((o) => o.id) };
}

export async function runSequenceLane(ctx: Omit<SeqContext, 'stage'> & { count: number; stage?: StageDef }) {
  const stage = ctx.stage ?? (await ensureStageDefinition(ctx.world.users.owner, `${ctx.world.tag}-${ctx.viewer}-${Date.now().toString(36)}`));
  const full = { ...ctx, stage } as SeqContext;
  for (let s = 0; s < ctx.count; s++) {
    for (let attempt = 0; ; attempt++) {
      for (const page of [ctx.session.pages.old, ctx.session.pages.new, ctx.truth])
        if (await ensurePage(page).catch(() => false)) ctx.result.repairs.push({ where: `before seq ${s}`, error: 'page left the app' });
      const before = ctx.result.failures.length;
      const steps = ctx.result.steps;
      const error = await runSequence({ ...full, rng: ctx.rng.fork(`seq-${s}`) }, s).then(() => undefined, (e) => e);
      if (!error) break;
      // The broken attempt's comparisons ran against pages that may have
      // left the app: drop them and run the sequence again, once.
      const dropped = ctx.result.failures.splice(before);
      ctx.result.steps = steps;
      if (error instanceof StepTimeout) {
        // The pages are stuck in an await that will never settle: load them again.
        for (const page of [ctx.session.pages.old, ctx.session.pages.new, ctx.truth]) {
          const why = await withDeadline(rebootPage(page), 5 * 60_000, 'reloading a stuck page').then(() => 'reloaded after a step ran out of time', (e) => `reload failed: ${String(e).slice(0, 150)}`);
          ctx.result.repairs.push({ where: `after seq ${s} timed out`, error: why });
        }
      }
      ctx.result.aborted.push({ seq: s, attempt, error: String(error).slice(0, 300), droppedFailures: dropped.length });
      if (attempt >= 1) {
        ctx.result.failures.push({ seq: s, step: -1, kind: 'harness-error', detail: String(error).slice(0, 500) });
        break;
      }
    }
    ctx.log(`seq ${ctx.viewer}: ${s + 1}/${ctx.count} (${ctx.result.steps} steps, ${ctx.result.failures.length} failures)`);
  }
}

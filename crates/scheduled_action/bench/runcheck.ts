// Putting the workspace back between drafts, and the run check: save a
// drafted routine, fire its trigger once with a made-up event, and read what
// the run changed straight from the stack's database.

import type { SQL } from 'bun';

import type { Case, Context, CopyMade, DraftResult, Effects, Fire } from './cases';
import { restoreStatuses, seedId, setTaskStatus, taskStatus } from './setup';
import { type Stack, call, sdk } from './stack';
import { OWNER, PERSON_KEYS, SCENARIO_NAME, userId } from './workspace';

/** Tokens for every seeded person, by key. */
export type Tokens = Record<string, string>;
type RoutineRequest = RequestInit & { token: string };

/** A routine as the scheduled-action API returns it. */
export type SavedRoutine = {
  id: string;
  name: string;
  enabled: boolean;
  kind: string;
  trigger: { type: string; [key: string]: unknown };
  task: { steps?: unknown[]; prompt?: string; [key: string]: unknown };
  created_at: string;
  updated_at: string;
  configuration_revision?: number;
  sub_routine?: { key?: string | null; paused_by_parent?: boolean } | null;
};

/** A sub-routine a routine defines, as its task holds it. */
type Definition = { name?: unknown; steps?: unknown[] };

/**
 * The copies `parent`'s runs scheduled of its sub-routines since `since`,
 * read before it is deleted, which deletes them too. A copy holds only which
 * sub-routine it runs and its inputs; its step kinds are its definition's in
 * `parent`.
 */
async function copiesOf(at: Stack, request: RoutineRequest, parent: SavedRoutine, since: Date): Promise<CopyMade[]> {
  const children = await call<SavedRoutine[]>(`${routines(at)}?parent=${parent.id}`, request);
  const definitions = (parent.task.sub_routines ?? []) as Definition[];
  const made = children.filter((child) => new Date(child.created_at).getTime() >= since.getTime() - 1000);
  return made.map((child) => {
    const { sub_routine: subRoutine, inputs } = child.task as { sub_routine?: unknown; inputs?: unknown };
    const definition = definitions.find((each) => each.name === subRoutine);
    const given = inputs && typeof inputs === 'object' ? (inputs as Record<string, unknown>) : {};
    return {
      id: child.id,
      subRoutine: typeof subRoutine === 'string' ? subRoutine : null,
      inputs: Object.keys(given),
      // Seeded ids, which the checks look the item up by.
      values: Object.values(given).filter((value): value is string => typeof value === 'string'),
      trigger: child.trigger,
      steps: (definition?.steps ?? []).map((step) => String((step as { type?: unknown }).type)),
      key: child.sub_routine?.key ?? null,
      switchedOff: !child.enabled && !child.sub_routine?.paused_by_parent,
    };
  });
}

/**
 * Run copy `id` at once, before its time, and wait for its run: what it does
 * when its time comes, with its definition read from the routine as now.
 * Nothing when it couldn't be run.
 */
async function runCopy(at: Stack, request: RoutineRequest, db: SQL, id: string): Promise<Effects['runs']> {
  const since = new Date();
  const signal = AbortSignal.timeout(RUN_TIMEOUT_MS);
  try {
    const started = await call<{ resource?: { id: string } | null; chat_id?: string | null } | undefined>(
      `${routines(at)}/${id}/execute`,
      { ...request, signal, method: 'POST' },
    );
    const resourceId = started?.resource?.id ?? started?.chat_id ?? undefined;
    // Execute waits for preparation. History gets the record after the run finishes.
    while (!signal.aborted) {
      const runs = await runsSince(at, { ...request, signal }, id, since, resourceId);
      if (runs.length) {
        await beforeDeadline(() => Bun.sleep(SETTLE_MS), signal, undefined);
        return await beforeDeadline(() => withReplies(db, runs), signal, runs);
      }
      await Bun.sleep(2000);
    }
  } catch {
    return [];
  }
  return [];
}

/**
 * What `work` gives, or `fallback` once `signal` aborts first, so a read
 * that never returns can't hold the attempt past its deadline. Work isn't
 * started once the deadline has passed.
 */
async function beforeDeadline<T>(work: () => Promise<T>, signal: AbortSignal, fallback: T): Promise<T> {
  if (signal.aborted) return fallback;
  const { promise: aborted, resolve } = Promise.withResolvers<T>();
  const stop = () => resolve(fallback);
  signal.addEventListener('abort', stop, { once: true });
  try {
    return await Promise.race([work(), aborted]);
  } finally {
    signal.removeEventListener('abort', stop);
  }
}

const routines = (at: Stack) => `${at.harness}/scheduled-action/scheduled-actions`;

/** Every routine the person has: the list leaves out event routines and sub-routines unless asked. */
export async function listRoutines(at: Stack, token: string): Promise<SavedRoutine[]> {
  return call<SavedRoutine[]>(`${routines(at)}?include_events=true&include_children=true`, { token });
}

/** Seeded ids start with the seed CLI's prefix; anything else the eval or a routine made. */
const SEEDED = '5eed';
/** This scenario's seeded ids: the prefix and two bytes of the scenario's name. */
const OURS = seedId(SCENARIO_NAME, '', '').slice(0, 8);

const personOf = (sender: string) =>
  PERSON_KEYS.find((key) => userId(key) === sender) ?? sender;

/**
 * Put the owner's workspace back to what `seed` and `setup` made: delete
 * every routine, the databases, documents, tasks, channels and messages
 * nobody seeded, and put back seeded tasks' statuses. Runs before and after
 * each case, so a draft never finds what an earlier draft, run or crashed
 * eval left behind. Edits to seeded items' text, due dates or other
 * properties, and direct messages a draft opened, are left.
 */
export async function reset(at: Stack, db: SQL, tokens: Tokens, keep: Set<string>) {
  const owner = tokens[OWNER];
  const macro = sdk(at, owner);
  let removed = 0;
  // The list puts sub-routines after their parents; deleting a parent
  // deletes its sub-routines and their grants, so theirs go first.
  for (const routine of (await listRoutines(at, owner)).reverse()) {
    try {
      await call(`${routines(at)}/${routine.id}`, { method: 'DELETE', token: owner });
    } catch (error) {
      // Already gone with its parent: no routine (404), or no grant left (401).
      if (!/ (401|404):/.test(String(error))) throw error;
    }
    removed++;
  }
  // A routine the list missed would fire during later drafts' run checks.
  const left = await db`select id from scheduled_action where owner = ${userId(OWNER)}`;
  if (left.length) throw new Error(`reset left ${left.length} routines the list didn't return`);
  // After the routines, so putting a task back fires nothing. A task a
  // session moved while testing, or a run check failed to put back, would
  // make a later run check fire a change that changes nothing.
  removed += await restoreStatuses(at, db, owner);
  for (const database of await macro.databases.list()) {
    if (keep.has(database.id)) continue;
    await trash(at, owner, 'DATABASE', database.id);
    removed++;
  }
  const documents = await db`
    select id from "Document"
    where owner = ${userId(OWNER)} and "deletedAt" is null and id::text not like ${`${SEEDED}%`}`;
  for (const { id } of documents as { id: string }[]) {
    if (keep.has(id)) continue;
    await macro.documents.byId(id).delete();
    removed++;
  }
  const messages = await db`
    select id, sender_id, parent_entity_id as channel from comms_messages
    where deleted_at is null and id::text not like ${`${SEEDED}%`} and parent_entity_type = 'channel'
      and (parent_entity_id::text like ${`${OURS}%`} or sender_id like ${'%@routines-eval.seed.macro.local'})`;
  for (const message of messages as { id: string; sender_id: string; channel: string }[]) {
    // The sender can delete their message; the owner owns every seeded channel.
    const person = personOf(message.sender_id);
    const token = tokens[person] ?? owner;
    try {
      await sdk(at, token).channels.byId(message.channel).message(message.id).delete();
    } catch {
      await sdk(at, owner).channels.byId(message.channel).message(message.id).delete();
    }
    removed++;
  }
  // A channel a draft made (#marketing, say) would give a later draft a match the case says isn't there.
  const channels = await db`
    select id from comms_channels
    where owner_id = ${userId(OWNER)} and channel_type <> 'direct_message' and id::text not like ${`${OURS}%`}`;
  for (const { id } of channels as { id: string }[]) {
    await macro.channels.byId(id).delete();
    removed++;
  }
  return removed;
}

/** Move an entity to the trash through Soup's GraphQL, as the web app does for databases. */
async function trash(at: Stack, token: string, type: string, id: string) {
  await call(`${at.storage}/items/soup/graphql`, {
    method: 'POST',
    token,
    body: JSON.stringify({
      query: `mutation Trash($id: ID!) { trashEntities(entities: [{ type: ${type}, id: $id }]) { results { __typename } } }`,
      variables: { id },
    }),
  });
}

/** Save a draft as the person's routine, the way the editor's Save does (not acting as them). */
export async function save(at: Stack, token: string, draft: DraftResult, enabled: boolean): Promise<SavedRoutine> {
  return call<SavedRoutine>(routines(at), {
    method: 'POST',
    token,
    body: JSON.stringify({
      name: draft.name ?? 'Eval routine',
      kind: 'Agent',
      enabled,
      trigger: draft.trigger,
      task: { steps: draft.steps, ...(draft.subRoutines?.length ? { sub_routines: draft.subRoutines } : {}) },
    }),
  });
}

/** The channels the owner made since `since`, which a request naming a missing channel must not get. */
export async function channelsMade(db: SQL, since: Date): Promise<string[]> {
  const rows = (await db`
    select id from comms_channels
    where owner_id = ${userId(OWNER)} and created_at >= ${since} and id::text not like ${`${OURS}%`}`) as { id: string }[];
  return rows.map((row) => row.id);
}

/** Whether a trigger fires on events (as opposed to a schedule or a time). */
export const onEvents = (trigger: unknown) => JSON.stringify(trigger ?? null).includes('"events"');

type RunRecord = {
  start_time: string;
  end_time: string;
  resource_id?: string | null;
  is_success: boolean;
  result: unknown;
};
// Builds before sub-routines list bare records; later ones wrap each with what its run created.
type HistoryEntry = RunRecord | { record: RunRecord };

async function runsSince(at: Stack, request: RoutineRequest, id: string, since: Date, resourceId?: string) {
  const history = await call<HistoryEntry[]>(`${routines(at)}/${id}/history`, request);
  return history
    .map((entry) => ('record' in entry ? entry.record : entry))
    .filter((record) => new Date(record.start_time).getTime() >= since.getTime() - 1000)
    .filter((record) => resourceId === undefined || record.resource_id === resourceId)
    .map((record) => ({ isSuccess: record.is_success, result: record.result }));
}

/** The agent session an agent step's run started. */
const agentOf = (run: Effects['runs'][number]) => {
  const resource = (run.result as { resource?: { type?: string; id?: string } | null } | null)?.resource;
  return resource?.type === 'agent' ? resource.id : undefined;
};

/** An agent step's reply: the text its session streamed, which the run's record leaves out. */
async function agentReply(db: SQL, session: string) {
  const rows = (await db`
    select content #>> '{params,update,content,text}' as text
    from agent_session_log
    where agent_session_id = ${session}::uuid and direction = 'to_server'
      and content #>> '{params,update,sessionUpdate}' = 'agent_message_chunk'
    order by created_at, id`) as { text: string | null }[];
  return rows.map((row) => row.text ?? '').join('');
}

/**
 * `runs` with their agent steps' replies, as the person reads them (a
 * mentioned document or task with its name); also fills results saved before
 * replies were read, or before they were read with names.
 */
export async function withReplies(db: SQL, runs: Effects['runs']) {
  return Promise.all(
    runs.map(async (run) => {
      const session = agentOf(run);
      const reply = run.reply ?? (session ? await agentReply(db, session) : undefined);
      if (reply === undefined) return run;
      const [named] = await withMentionNames(db, [reply]);
      return { ...run, reply: named };
    }),
  );
}

/** How long a fired routine gets to finish its run. */
const RUN_TIMEOUT_MS = 240_000;
/** What a run writes can land just after its record. */
const SETTLE_MS = 5_000;
/**
 * An event the trigger matches is admitted within seconds (a few on a loaded
 * machine); one not admitted by now never will be, so the wait stops.
 */
const ADMIT_MS = 90_000;

/** Whether an event was admitted to run `routine` since `since`: its trigger matched. */
async function admitted(db: SQL, routine: string, since: Date) {
  const rows = await db`
    select 1 from scheduled_action_event_run where action_id = ${routine}::uuid and admitted_at >= ${since} limit 1`;
  return rows.length > 0;
}

export type RunOutcome = {
  says: string;
  fired: Fire['type'];
  holds: boolean;
  /** Fired to the run's record, or to the timeout. */
  ms: number;
  timedOut: boolean;
  effects: Effects;
  error?: string;
};

/**
 * Fire `routine` once as `item.run` says, wait for its run, read what it
 * changed and check it. Puts back what firing changed (a task's status);
 * `reset` removes the rest.
 */
export async function runCheck(
  at: Stack,
  db: SQL,
  tokens: Tokens,
  item: Case,
  draft: DraftResult,
  routine: SavedRoutine,
  context: Context,
  traceparent: string,
): Promise<RunOutcome | undefined> {
  if (!item.run) return undefined;
  const owner = tokens[OWNER];
  const request = { token: owner, headers: { traceparent } };
  const fire = item.run.fire(draft);
  const t0 = new Date();
  let firedMessage: string | undefined;
  let restore: (() => Promise<void>) | undefined;
  const started = performance.now();
  let error: string | undefined;
  try {
    if (fire.type === 'execute') {
      await call(`${routines(at)}/${routine.id}/execute`, { ...request, method: 'POST' });
    } else if (fire.type === 'message') {
      const sent = await sdk(at, tokens[fire.from]).channels.byId(context.ids[fire.channel]).send(fire.text);
      firedMessage = sent.id;
    } else if (fire.type === 'task_status') {
      const id = context.ids[fire.task];
      // Putting it back now would fire a routine already on; a draft that moved
      // the person's task fails, saying so, and `reset` puts it back.
      const was = await taskStatus(db, id);
      if (was === fire.restore) {
        await setTaskStatus(at, owner, id, fire.status);
        restore = () => setTaskStatus(at, owner, id, fire.restore);
      } else error = `the task was ${was ?? 'unset'}, not ${fire.restore}: the draft moved it`;
    } else {
      const project = fire.project ? sdk(at, owner).projects.byId(context.ids[fire.project]) : undefined;
      await sdk(at, owner).tasks.create({ name: fire.name, project });
    }
  } catch (cause) {
    error = `firing failed: ${String(cause)}`;
  }
  let runs: Effects['runs'] = [];
  let timedOut = false;
  let ms = 0;
  let effects: Effects;
  try {
    if (!error) {
      for (;;) {
        runs = await runsSince(at, request, routine.id, t0);
        if (runs.length) break;
        const waited = performance.now() - started;
        if (waited > RUN_TIMEOUT_MS) {
          timedOut = true;
          break;
        }
        if (fire.type !== 'execute' && waited > ADMIT_MS && !(await admitted(db, routine.id, t0))) {
          timedOut = true;
          error = `no event matched its trigger in ${ADMIT_MS / 1000} s`;
          break;
        }
        await Bun.sleep(2000);
      }
    }
    ms = performance.now() - started;
    if (runs.length) await Bun.sleep(SETTLE_MS);
    runs = runs.length ? await withReplies(db, await runsSince(at, request, routine.id, t0)) : runs;
    const copies = await copiesOf(at, request, routine, t0);
    if (item.run.runCopies) {
      await Promise.all(
        copies.map(async (copy) => {
          if (copy.subRoutine !== null && copy.id) copy.runs = await runCopy(at, request, db, copy.id);
        }),
      );
    }
    effects = await read(db, context, t0, firedMessage, (id) => sdk(at, owner).tasks.byId(id).content());
    effects.runs = runs;
    effects.copies = copies;
    effects.firedAt = t0.toISOString();
  } finally {
    // Deleted first, so putting the task back doesn't fire it again.
    await call(`${routines(at)}/${routine.id}`, { ...request, method: 'DELETE' }).catch(() => undefined);
    // Left changed, the task couldn't fire the next draft's run.
    await restore?.().catch(() => undefined);
  }
  return {
    says: item.run.says,
    fired: fire.type,
    holds: !error && item.run.holds(effects, context),
    ms,
    timedOut,
    effects,
    error,
  };
}

const DOCUMENT_MENTION = /<m-document-mention>(.*?)<\/m-document-mention>/gs;

/**
 * Messages as the person reads them: a mention of a document or task shows
 * its name, which the mention itself may leave out. The name goes after the
 * mention, once, so reading saved effects again doesn't add it twice.
 */
export async function withMentionNames(db: SQL, texts: string[]): Promise<string[]> {
  const idOf = (json: string) => {
    try {
      return (JSON.parse(json) as { documentId?: unknown }).documentId;
    } catch {
      return undefined;
    }
  };
  const ids = [
    ...new Set(texts.flatMap((text) => [...text.matchAll(DOCUMENT_MENTION)].map((match) => idOf(match[1])))),
  ].filter((id): id is string => typeof id === 'string');
  if (!ids.length) return texts;
  const rows = (await db`select id, name from "Document" where id in ${db(ids)}`) as { id: string; name: string }[];
  const name = new Map(rows.map((row) => [row.id, row.name]));
  return texts.map((text) =>
    text.replace(DOCUMENT_MENTION, (whole: string, json: string, at: number, all: string) => {
      const id = idOf(json);
      if (typeof id !== 'string' || !name.has(id)) return whole;
      const shown = ` ${name.get(id)}`;
      return all.startsWith(shown, at + whole.length) ? whole : `${whole}${shown}`;
    }),
  );
}

/**
 * What changed in the owner's workspace since `since`, from the stack's
 * database: messages in channels they're in and tasks they own, so others
 * using the stack can't make a run look as if it reported something. A
 * task's body is read with `body`, as the owner.
 */
async function read(
  db: SQL,
  context: Context,
  since: Date,
  fired: string | undefined,
  body: (task: string) => Promise<string>,
): Promise<Effects> {
  const names = new Map(Object.entries(context.ids).map(([name, id]) => [id, name]));
  const messages = (await db`
    select m.id, m.sender_id, m.content, m.parent_entity_id as channel, c.name as channel_name
    from comms_messages m join comms_channels c on c.id::text = m.parent_entity_id
    where m.created_at >= ${since} and m.deleted_at is null and m.parent_entity_type = 'channel'
      and exists (
        select 1 from comms_channel_participants p
        where p.channel_id = c.id and p.user_id = ${userId(OWNER)} and p.left_at is null)
    order by m.created_at`) as { id: string; sender_id: string; content: string; channel: string; channel_name: string | null }[];
  const tasks = (await db`
    select d.id, d.name from "Document" d join document_sub_type t on t.document_id = d.id
    where t.sub_type = 'task' and d."createdAt" >= ${since} and d."deletedAt" is null and d.owner = ${userId(OWNER)}
    order by d."createdAt"`) as { id: string; name: string }[];
  const notifications = (await db`
    select n.metadata from user_notification u join notification n on n.id = u.notification_id
    where u.user_id = ${userId(OWNER)} and u.created_at >= ${since}`) as { metadata: unknown }[];
  const posted = messages.filter((message) => message.id !== fired);
  const texts = await withMentionNames(db, posted.map((message) => message.content));
  return {
    runs: [],
    messages: posted.map((message, index) => ({
      channel: names.get(message.channel) ?? `new:${message.channel_name ?? message.channel}`,
      from: personOf(message.sender_id),
      text: texts[index],
    })),
    // A body that can't be read is checked as empty, as before bodies were read.
    tasks: await Promise.all(
      tasks.map(async (task) => ({ id: task.id, name: task.name, text: await body(task.id).catch(() => '') })),
    ),
    notifications: notifications.map((row) => JSON.stringify(row.metadata)),
  };
}


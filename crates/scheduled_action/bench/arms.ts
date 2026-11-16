// The two ways a person gets a routine drafted, as the eval's arms:
//
// - `draft`: the routine editor's Draft it as a blocking request
//   (`POST /scheduled-actions/drafts`), timed from the request to the answer.
//   Background drafts (`draft-jobs`) run the same drafter; their admission
//   wait and progress updates aren't timed.
// - `bare`: an ordinary agent chat asked to create the routine, timed from
//   the message to the routine existing.
//
// Both hand back a `DraftResult`, so the same checks judge them.

import { randomBytes } from 'node:crypto';

import type { Case, DraftResult } from './cases';
import { type SavedRoutine, listRoutines, save } from './runcheck';
import { type Stack, call } from './stack';

export type CatalogEntry = { key: string; title: string; trigger: unknown; code?: unknown };

export async function catalog(at: Stack, token: string, timezone: string): Promise<CatalogEntry[]> {
  return call<CatalogEntry[]>(
    `${at.harness}/scheduled-action/scheduled-actions/catalog?timezone=${encodeURIComponent(timezone)}`,
    { token },
  );
}

/** A fresh W3C trace for one attempt, so its spans can be read back from Tempo. */
export function traceparent() {
  const traceId = randomBytes(16).toString('hex');
  return { traceId, header: `00-${traceId}-${randomBytes(8).toString('hex')}-01` };
}

/** The base routine a step case changes: a catalog routine with its one code step. */
export function baseRoutine(item: Case, entries: CatalogEntry[]) {
  const base = entries.find((entry) => entry.key === item.base?.catalogKey);
  if (!base?.code) throw new Error(`catalog routine ${item.base?.catalogKey} with a code step not found`);
  return { name: base.title, trigger: base.trigger, steps: [base.code] };
}

/**
 * Fails before any draft when the stack can't save event routines: every
 * event-triggered draft's check would then fail and the session would keep
 * retrying, which times nothing real.
 */
export async function preflight(at: Stack, token: string, entries: CatalogEntry[]) {
  const base = entries.find((entry) => entry.code && (entry.trigger as { type?: string }).type === 'events');
  if (!base) return;
  const { problems } = await call<{ problems: string[] }>(`${at.harness}/scheduled-action/scheduled-actions/check`, {
    method: 'POST',
    token,
    body: JSON.stringify({
      routine: { name: 'Preflight', kind: 'Agent', enabled: false, trigger: base.trigger, task: { steps: [base.code] } },
      created: [],
    }),
  });
  if (problems.some((problem) => /event-trigger management/.test(problem))) {
    throw new Error(
      'the stack has event routines off: the owner needs the enable-event-routines PostHog flag, or EVENT_ROUTINES_ENABLED=true on older builds (see README)',
    );
  }
}

export type ArmResult = {
  traceId: string;
  /** When the timed part started, as an instant (ms since the epoch). */
  startedAtMs: number;
  /** The timed part: the draft request to its answer, or the message to the routine existing. */
  wallMs: number;
  status?: number;
  draft?: DraftResult;
  error?: string;
  /** Bare arm: the message to the end of the agent's turn. */
  turnMs?: number;
  /** Bare arm: the agent's reply, its last message. */
  reply?: string;
  /** Bare arm: it answered with a question and made no routine. */
  asked?: boolean;
  /** Bare arm: the routine it made or changed, as saved. */
  routine?: SavedRoutine;
  /** Bare arm: its session. */
  sessionId?: string;
};

// ---------- draft arm ----------

function requestBody(item: Case, entries: CatalogEntry[], model: string, timezone: string) {
  const context = { timezone, agentModel: model, code: item.code, conditions: true };
  if (item.kind === 'routine') return { draft: { type: 'routine', description: item.text }, context };
  const { trigger, steps } = baseRoutine(item, entries);
  const routine = { trigger, steps };
  if (item.kind === 'add_step') return { draft: { type: 'add_step', description: item.text, routine }, context };
  return { draft: { type: 'change_step', instruction: item.text, routine, index: item.index ?? 0 }, context };
}

export async function draftArm(
  at: Stack,
  token: string,
  item: Case,
  entries: CatalogEntry[],
  model: string,
  timezone: string,
): Promise<ArmResult> {
  const { traceId, header } = traceparent();
  const startedAtMs = Date.now();
  const started = performance.now();
  const response = await fetch(`${at.harness}/scheduled-action/scheduled-actions/drafts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', traceparent: header },
    body: JSON.stringify(requestBody(item, entries, model, timezone)),
  });
  const text = await response.text();
  const wallMs = performance.now() - started;
  let draft: DraftResult | undefined;
  try {
    draft = JSON.parse(text) as DraftResult;
  } catch {}
  return {
    traceId,
    startedAtMs,
    wallMs,
    status: response.status,
    draft,
    error: response.ok ? undefined : text.slice(0, 500),
  };
}

// ---------- bare arm ----------

/** What the person types in an ordinary agent chat. */
export function barePrompt(item: Case, baseName?: string) {
  if (item.kind === 'routine') return `Create a routine: ${item.text}`;
  if (item.kind === 'add_step') return `Add a step to my routine "${baseName}": ${item.text}`;
  return `In my routine "${baseName}", change step ${(item.index ?? 0) + 1}: ${item.text}`;
}

/** How long a bare session gets to finish its turn. */
const TURN_TIMEOUT_MS = 300_000;
const POLL_MS = 500;

type LogEntry = { createdAt: string; direction: string; content: Record<string, unknown> };

/**
 * The session's log: whether its turn ended, the agent's last message, and
 * a question it put to the person (`AskUser`), which holds the turn open
 * until someone answers, so it ends the wait like the turn ending.
 */
async function turn(at: Stack, token: string, id: string) {
  const { entries } = await call<{ entries: LogEntry[] }>(`${at.harness}/agent-sessions/${id}/log`, { token });
  let ended: number | undefined;
  let question: { at: number; text: string } | undefined;
  let reply = '';
  for (const entry of entries) {
    const content = entry.content as {
      method?: string;
      result?: { stopReason?: string };
      params?: { message?: string; update?: { sessionUpdate?: string; content?: { text?: string } } };
    };
    if (entry.direction !== 'to_server') continue;
    const update = content.params?.update;
    // A new message after a tool call starts a new reply.
    if (update?.sessionUpdate === 'tool_call') reply = '';
    if (update?.sessionUpdate === 'agent_message_chunk') reply += update.content?.text ?? '';
    if (content.method === 'elicitation/create') {
      question = { at: new Date(entry.createdAt).getTime(), text: content.params?.message ?? '' };
    }
    if (content.result?.stopReason) ended = new Date(entry.createdAt).getTime();
  }
  return { ended, reply, question };
}

/** Riley's routines changed since the session started: made, or (for a step case) the base saved again. */
function changed(list: SavedRoutine[], base: SavedRoutine | undefined, since: number) {
  if (base) {
    const now = list.find((routine) => routine.id === base.id);
    if (now && (now.updated_at !== base.updated_at || now.configuration_revision !== base.configuration_revision)) {
      return { routine: now, at: new Date(now.updated_at).getTime() };
    }
    const made = list.find((routine) => routine.id !== base.id && new Date(routine.created_at).getTime() >= since);
    return made ? { routine: made, at: new Date(made.created_at).getTime() } : undefined;
  }
  const made = list
    .filter((routine) => new Date(routine.created_at).getTime() >= since - 1000)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  return made ? { routine: made, at: new Date(made.created_at).getTime() } : undefined;
}

/** A saved routine in the draft endpoint's shape, so the same checks read it. */
function asDraft(item: Case, routine: SavedRoutine, base?: { steps: unknown[] }): DraftResult {
  const steps = routine.task.steps;
  if (item.kind === 'routine') {
    return {
      outcome: 'routine',
      name: routine.name,
      trigger: routine.trigger,
      steps,
      task: steps ? undefined : routine.task,
      problems: [],
    };
  }
  const baseSteps = base?.steps.length ?? 0;
  const step =
    item.kind === 'add_step'
      ? steps && steps.length > baseSteps
        ? steps.slice(baseSteps)
        : (steps ?? routine.task)
      : (steps?.[item.index ?? 0] ?? steps ?? routine.task);
  return { outcome: 'step', name: routine.name, trigger: routine.trigger, step, problems: [] };
}

export async function bareArm(
  at: Stack,
  token: string,
  item: Case,
  entries: CatalogEntry[],
  model: string,
): Promise<ArmResult> {
  let base: SavedRoutine | undefined;
  let baseShape: ReturnType<typeof baseRoutine> | undefined;
  if (item.kind !== 'routine') {
    baseShape = baseRoutine(item, entries);
    // Saved off, so it doesn't run on the person's tasks while the agent works.
    base = await save(at, token, { outcome: 'routine', ...baseShape }, false);
  }
  const { traceId, header } = traceparent();
  const id = Bun.randomUUIDv7();
  const startedAtMs = Date.now();
  const started = performance.now();
  await call(`${at.harness}/agent-sessions`, {
    method: 'POST',
    token,
    headers: { traceparent: header },
    body: JSON.stringify({ id, model, prompt: barePrompt(item, baseShape?.name), promptActionId: Bun.randomUUIDv7() }),
  });
  let found: { routine: SavedRoutine; at: number } | undefined;
  let ended: number | undefined;
  let question: { at: number; text: string } | undefined;
  let reply = '';
  let polls = 0;
  try {
    while (performance.now() - started < TURN_TIMEOUT_MS) {
      await Bun.sleep(POLL_MS);
      polls++;
      found ??= changed(await listRoutines(at, token), base, startedAtMs);
      // The log is the whole session, so it's read every few polls.
      if (polls % 4 === 0 || found) {
        ({ ended, reply, question } = await turn(at, token, id));
        if (ended || question) break;
      }
    }
  } catch (error) {
    // A session left running would act during later drafts.
    await deleteSession(at, token, id);
    throw error;
  }
  // A question to the person ends the turn's timed part: it waits for an answer.
  ended ??= question?.at;
  if (question) reply = `${reply}\n\nAsked: ${question.text}`.trim();
  const turnMs = ended ? ended - startedAtMs : undefined;
  // The routine as the turn left it: the agent may fix it after saving, or
  // delete it and save another, timed to when that one was made.
  let kept: { routine: SavedRoutine; at: number } | undefined;
  if (found) {
    const first = found;
    const list = await listRoutines(at, token);
    const same = list.find((routine) => routine.id === first.routine.id);
    kept = same ? { routine: same, at: first.at } : changed(list, base, startedAtMs);
  }
  const routine = kept?.routine;
  const draft: DraftResult = routine
    ? asDraft(item, routine, baseShape)
    : { outcome: 'failed', message: reply.slice(0, 2000) };
  return {
    traceId,
    startedAtMs,
    // Without a routine, the time is the whole turn (or the timeout).
    wallMs: kept ? kept.at - startedAtMs : (turnMs ?? performance.now() - started),
    draft,
    // A routine that exists is an answer, even from a turn still running.
    error: ended || routine ? undefined : 'turn did not end',
    turnMs,
    reply: reply.slice(0, 4000),
    // A question that ends a finished turn; a turn that timed out asked nothing.
    asked: !routine && (question !== undefined || (ended !== undefined && /\?/.test(reply))),
    routine,
    sessionId: id,
  };
}

export async function deleteSession(at: Stack, token: string, id: string) {
  await call(`${at.harness}/agent-sessions/${id}`, { method: 'DELETE', token }).catch(() => undefined);
}

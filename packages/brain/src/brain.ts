import * as nodeFs from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
// The running brain: events in, Jev, lanes, tiered turns, commits out.
//
// message.posted → history → (work running in that conversation? inject) →
// Jev → the conversation's lane → a respond turn. The heartbeat and schedule
// wake-ups start heartbeat turns; hand-offs start work turns. Every turn
// commits the workspace when it ends.
import { join } from 'node:path';
import { SpanStatusCode } from '@opentelemetry/api';
import { SpendLedger } from './budget.ts';
import { parseVoiceConfig } from './calls/config.ts';
import type { CallPolicy, CallTransport } from './calls/transport.ts';
import type { Config } from './config.ts';
import {
  type Control,
  type Conversation,
  controlHandler,
  type Health,
} from './control.ts';
import {
  AGENT_SESSION_OPENED,
  abortableSleep,
  eventStream,
  MESSAGE_POSTED,
  type MessagePosted,
  missedMessages,
  type StreamItem,
} from './events.ts';
import { Filter } from './filter.ts';
import {
  HeartbeatStore,
  snapshotHash,
  snapshotText,
  wakeReason,
} from './heartbeat.ts';
import { type Entry, History } from './history.ts';
import { closeHttp, serveHttp } from './http.ts';
import type { Candidate, Decision } from './jev.ts';
import { Lanes } from './lanes.ts';
import { Learning, type MustWakeFixture, TUNE_TASK } from './learning.ts';
import type { ChannelDetail, MacroHttp } from './macro.ts';
import { Memory } from './memory.ts';
import { Pool } from './pool.ts';
import { startTyping } from './presence.ts';
import {
  heartbeatPrompt,
  respondPrompt,
  talkCommands,
  workPrompt,
} from './prompts.ts';
import type { RunHandle, Runner, Tier } from './runner.ts';
import { type Routines, Schedules, type Trigger } from './schedules.ts';
import { startSpan } from './telemetry.ts';
import type { BrainCall, OutboundNext, PostResult, Wiring } from './wiring.ts';
import { conversationKey, type Tasks, Work } from './work.ts';
import { type Git, GitWriter, Workspace } from './workspace.ts';

export type { Wiring } from './wiring.ts';
export type BrainDeps = {
  config: Omit<Config, 'macroApiKey' | 'anthropicAuthToken' | 'executable'>;
  /** Frozen composition/config snapshot selected by the supervisor. */
  wiringRoot?: string;
  http: MacroHttp;
  tasks: Tasks;
  routines: Routines;
  runner: Runner;
  git: Git;
  /** Live presence adapter retains its credential in the library. */
  presence: () => () => void;
  calls?: CallTransport;
  /** The `brain` executable turns call. */
  exe: string;
  /** PATH and HOME for turns. */
  baseEnv: Record<string, string>;
  log(line: object): void;
};
const RELEVANCE_CONTEXT = 6;
const PROMPT_HISTORY = 20;
const SEEN_LIMIT = 5000;
const stamp = () => new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
export class Brain implements Control {
  private readonly deps: BrainDeps;
  private readonly wiring: Wiring;
  readonly workspace: Workspace;
  private readonly writer: GitWriter;
  private readonly memory: Memory;
  private readonly history: History;
  private readonly ledger: SpendLedger;
  private readonly heartbeatStore: HeartbeatStore;
  private readonly learning: Learning;
  private readonly filter: Filter;
  private readonly turnSources = new Map<string, string[]>();
  private readonly postedTurns = new Set<string>();
  private readonly reactedTurns = new Set<string>();
  private creator = '';
  private tuneRunning = false;
  private readonly controlToken = crypto.randomUUID();
  private readonly channels = new Map<string, ChannelDetail>();
  private readonly seen = new Set<string>();
  private readonly typing = new Map<string, () => Promise<void>>();
  private readonly startedAt = new Date().toISOString();
  private readonly problems = new Set<string>();
  private draining = false;
  private me = '';
  private connected = false;
  private lastEventAt: string | null = null;
  private heartbeatRunning = false;
  private pool!: Pool;
  private work!: Work;
  private lanes!: Lanes<Entry>;
  private scheduleBook!: Schedules;
  constructor(deps: BrainDeps, wiring: Wiring = {}) {
    this.deps = deps;
    this.wiring = wiring;
    this.workspace = new Workspace(deps.config.workspace, deps.wiringRoot);
    this.writer = new GitWriter(this.workspace, deps.git);
    this.memory = new Memory(this.workspace, this.writer);
    this.learning = new Learning(this.workspace, this.writer);
    this.filter = new Filter(this.workspace, wiring, deps.http, (line) =>
      this.appendLog('decisions.jsonl', line)
    );
    this.history = new History(this.workspace.path('history'));
    this.ledger = new SpendLedger(this.workspace.path('cache'));
    this.heartbeatStore = new HeartbeatStore(this.workspace.path('cache'));
  }
  private intake?: AsyncIterable<StreamItem>;
  private preparing?: Promise<void>;
  /** Open intake alongside the old generation, buffering until run takes ownership. */
  prepare(signal: AbortSignal): Promise<void> {
    this.preparing ??= this.connectIntake(signal);
    return this.preparing;
  }
  private async connectIntake(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const persona = await this.workspace.persona();
    const ready = Promise.withResolvers<void>();
    const aborted = () =>
      ready.reject(new Error('intake aborted before readiness'));
    signal.addEventListener('abort', aborted, { once: true });
    this.intake = eventStream(
      {
        open: (connection) =>
          this.deps.http.openEventStream(
            [
              {
                events: [
                  MESSAGE_POSTED,
                  AGENT_SESSION_OPENED,
                  ...persona.events.events,
                  ...(this.wiring.subscriptions ?? []),
                ],
              },
            ],
            connection
          ),
        sleep: abortableSleep,
        log: (line) => {
          const state = 'events' in line ? line.events : null;
          if (state === 'connected') {
            this.connected = true;
            ready.resolve();
          }
          if (state === 'failed' || state === 'ended') this.connected = false;
          this.log(line);
        },
      },
      signal
    );
    try {
      await ready.promise;
    } finally {
      signal.removeEventListener('abort', aborted);
    }
  }
  private previousHealth: string | undefined;
  private log(line: object) {
    if (
      'batch_failed' in line ||
      'handle_failed' in line ||
      'heartbeat_failed' in line
    )
      this.problems.add('event handling failed');
    if ('turn' in line && 'status' in line) {
      if (line.status === 'success') {
        this.problems.delete('turn execution failed');
        this.problems.delete('event handling failed');
      } else this.problems.add('turn execution failed');
    }
    this.deps.log(line);
  }
  private async appendLog(name: string, line: object) {
    const dir = this.workspace.path('log');
    await nodeFs.mkdir(dir, { recursive: true });
    await nodeFs.writeFile(
      join(dir, name),
      `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`,
      { flag: 'a' }
    );
  }
  /** Run until `signal` aborts. Startup fails loudly on a broken persona or an unreachable Macro. */
  async run(signal: AbortSignal): Promise<void> {
    await this.prepare(signal);
    // The previous generation saved receipts only after admitting its final events.
    try {
      const receipts: string[] = JSON.parse(
        await nodeFs.readFile(
          this.workspace.path('cache/event-receipts.json'),
          'utf8'
        )
      );
      for (const id of receipts) this.seen.add(id);
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
      )
        throw error;
    }
    await this.workspace.enforceGitignore();
    const persona = await this.workspace.persona();
    this.creator =
      /^- (.+) set me up\./m.exec(
        await this.workspace.read('OPERATING.md')
      )?.[1] ?? '';
    await this.learning.resume();
    this.me = (await this.deps.http.me()).user_id;
    this.log({ brain: 'starting', me: this.me, brain_lock: persona.brainLock });
    this.pool = new Pool({
      runner: this.deps.runner,
      limits: {
        triage: 1,
        ...persona.events.concurrency,
        ...Object.fromEntries(
          Object.entries(this.wiring.tiers ?? {}).map(([name, tier]) => [
            name,
            tier.concurrency,
          ])
        ),
      },
      speaking: Object.fromEntries(
        Object.entries(this.wiring.tiers ?? {}).map(([name, tier]) => [
          name,
          tier.speaking ?? false,
        ])
      ),
      beforeTurn: (turn) => {
        const prepared = { ...turn, tools: turn.tools ?? this.wiring.tools };
        return this.wiring.beforeTurn?.(prepared) ?? prepared;
      },
      afterTurn: this.wiring.afterTurn,
      budget: async () => {
        const budget = (await this.workspace.persona()).budget;
        return {
          ...budget,
          perRunUsd: {
            triage: 0.05,
            ...budget.perRunUsd,
            ...Object.fromEntries(
              Object.entries(this.wiring.tiers ?? {}).map(([name, tier]) => [
                name,
                tier.perRunUsd,
              ])
            ),
          },
        };
      },
      ledger: this.ledger,
      log: (line) => this.log(line),
    });
    this.work = new Work({
      pool: this.pool,
      limit: persona.events.concurrency.work,
      tasks: this.deps.tasks,
      git: this.deps.git,
      workDir: this.workspace.path('work'),
      turn: async (task, conversation, description) => {
        const current = await this.workspace.persona();
        return {
          tier:
            (await this.wiring.route?.({
              kind: 'work',
              task,
              conversation,
              description,
            })) ?? 'work',
          prompt: workPrompt({
            instructions: current.prompts.work,
            talk: talkCommands(this.deps.exe, 'work'),
            task: description,
            taskUrl: task.url,
            conversation,
          }),
          system: current.operating,

          model: current.events.model,
          env: this.turnEnv(`work-${task.id}`),
        };
      },
      report: (conversation, text) =>
        this.pool.speak(() =>
          this.say(null, conversation, text).then(() => undefined)
        ),
      commit: (turnId, summary) => this.writer.commitTurn(turnId, summary),
      log: (line) => this.log(line),
    });
    this.scheduleBook = new Schedules(
      this.workspace,
      this.writer,
      this.deps.routines,
      persona.events.scheduleModel
    );
    for (const configured of this.wiring.schedules ?? []) {
      const existing = (await this.scheduleBook.list()).find(
        (schedule) => schedule.note === configured.note
      );
      if (
        existing &&
        JSON.stringify(existing.trigger) === JSON.stringify(configured.trigger)
      )
        continue;
      if (existing) await this.scheduleBook.delete(existing.routineId);
      await this.scheduleBook.create(configured.note, configured.trigger);
    }
    this.lanes = new Lanes<Entry>(
      this.workspace.path('cache', 'lanes'),
      (lane, batch) => this.respond(lane, batch),
      (line) => this.log(line)
    );
    const resumed = await this.lanes.resume();
    if (resumed > 0) this.log({ lanes_resumed: resumed });
    const server = await serveHttp(
      {
        hostname: '127.0.0.1',
        port: this.deps.config.healthPort,
      },
      controlHandler(this, this.controlToken, (line) => this.log(line))
    );
    const offline = this.deps.presence();
    const callStop = new AbortController();
    const callSignal = AbortSignal.any([signal, callStop.signal]);
    const calls = this.deps.calls
      ?.watch((call) => this.onCall(call), callSignal, this.me)
      .catch((error: unknown) => {
        this.problems.add('calls');
        this.log({ calls_failed: String(error) });
      });
    const heartbeats = new Set<Promise<void>>();
    const queueHeartbeat = (reason: string | null) => {
      const running = this.heartbeat(reason)
        .catch((error) => this.log({ heartbeat_failed: String(error) }))
        .finally(() => heartbeats.delete(running));
      heartbeats.add(running);
    };
    const heartbeat = setInterval(
      () => queueHeartbeat(null),
      persona.events.heartbeatMinutes * 60000
    );
    this.scheduleBook
      .reconcile()
      .catch((error) =>
        this.log({ schedules_reconcile_failed: String(error) })
      );
    const stream = this.intake;
    if (!stream) throw new Error('intake was not prepared');
    try {
      for await (const item of stream) {
        if (item.kind === 'reconnected') {
          await this.catchUp(item.disconnectedAt).catch((error) =>
            this.log({ catch_up_failed: String(error) })
          );
          continue;
        }
        this.lastEventAt = new Date().toISOString();
        const { event } = item;
        if (!this.markSeen(`event:${event.eventId}`)) continue;
        await this.wiring.onEvent?.(event, this);
        if (event.type === MESSAGE_POSTED) {
          try {
            if (
              this.wiring.learning &&
              event.metadata.parent.type !== 'channel'
            ) {
              if (event.metadata.sender === this.me) continue;
              await this.onGenericEvent(
                event.eventId,
                MESSAGE_POSTED,
                event.metadata,
                event.metadata
              );
              continue;
            }
            await this.onMessage(event.metadata);
          } catch (error) {
            this.log({
              message_id: event.metadata?.message_id,
              handle_failed: String(error),
            });
          }
        } else if (event.type === AGENT_SESSION_OPENED) {
          const wake = await this.scheduleBook.wakeFor(event.metadata, this.me);
          if (wake) {
            if (await this.onSchedule(wake)) continue;
            const reason = wake.schedule
              ? `schedule: ${wake.schedule.note}`
              : `a routine run with no schedule record: ${wake.sessionName}`;
            queueHeartbeat(reason);
          } else if (this.wiring.learning) {
            await this.onGenericEvent(
              event.eventId,
              AGENT_SESSION_OPENED,
              event.metadata
            );
          }
        } else {
          const metadata = event.metadata;
          if (
            event.eventType.includes('reaction') &&
            typeof metadata === 'object' &&
            metadata !== null &&
            'message_id' in metadata &&
            typeof metadata.message_id === 'string'
          ) {
            const negative =
              'emoji' in metadata &&
              /thumbs_down|👎/.test(String(metadata.emoji));
            await this.learning.reaction(metadata.message_id, !negative);
          }
          if (this.wiring.learning)
            await this.onGenericEvent(event.eventId, event.eventType, metadata);
          else
            await this.learning.record({
              kind: 'event',
              event_type: event.eventType,
              woke: false,
            });
        }
      }
    } finally {
      clearInterval(heartbeat);
      offline();
      callStop.abort();
      await calls;
      this.draining = true;
      await this.lanes.shutdown();
      await this.work.drain();
      await Promise.all(heartbeats);
      await nodeFs.writeFile(
        this.workspace.path('cache/event-receipts.json'),
        JSON.stringify([...this.seen])
      );
      await closeHttp(server);
      this.log({ brain: 'stopped' });
    }
  }
  /** Environment a turn's tools get: how to reach this brain, never the Macro key. */
  private turnEnv(turnId: string): Record<string, string> {
    return {
      ...this.deps.baseEnv,
      BRAIN_HEALTH_PORT: String(this.deps.config.healthPort),
      BRAIN_CONTROL_TOKEN: this.controlToken,
      BRAIN_TURN_ID: turnId,
    };
  }
  private async channel(channelId: string): Promise<ChannelDetail> {
    const cached = this.channels.get(channelId);
    if (cached) return cached;
    const detail = await this.deps.http.channel(channelId);
    this.channels.set(channelId, detail);
    return detail;
  }
  private markSeen(id: string): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > SEEN_LIMIT) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }
  private mentionsMe(posted: MessagePosted): boolean {
    const me = this.me.toLowerCase();
    if (
      (posted.mentions ?? []).some(
        (mention) => mention.entity_id.toLowerCase() === me
      )
    )
      return true;
    return posted.content.toLowerCase().includes(`"userid":"${me}"`);
  }
  async onMessage(posted: MessagePosted): Promise<void> {
    if (posted.parent.type !== 'channel' || !this.markSeen(posted.message_id))
      return;
    const detail = await this.channel(posted.parent.id);
    const dm = detail.channel_type === 'direct_message';
    const entry: Entry = {
      id: posted.message_id,
      channelId: detail.channel_id,
      channel: detail.channel_name,
      root: posted.root_id,
      thread: posted.thread_id ?? null,
      dm,
      from: posted.sender,
      at: posted.created_at,
      text: posted.content,
      mentionsMe: this.mentionsMe(posted),
    };
    const recent = await this.history.recent(
      entry.channelId,
      RELEVANCE_CONTEXT
    );
    await this.history.append(entry);
    if (entry.from === this.me) return;
    const key = conversationKey({
      channel: entry.channelId,
      root: dm ? null : entry.root,
    });
    const judged = (message: Entry) => ({
      id: message.id,
      from: message.from,
      at: message.at,
      text: message.text,
      thread: message.thread,
    });
    const candidate: Candidate = {
      messageId: entry.id,
      channel: entry.channel,
      mentionsMe: entry.mentionsMe,
      directMessage: dm,
      fromCreator: entry.from === this.creator,
      inMyThread: recent.some(
        (message) => message.from === this.me && message.root === entry.root
      ),
      message: judged(entry),
      recent: recent.map(judged),
    };
    const decision = await this.evaluate(candidate);
    await this.learning.decided(candidate, decision);
    const referenced =
      posted.thread_id ??
      (posted.root_id !== posted.message_id
        ? posted.root_id
        : recent
            .filter(
              (message) =>
                message.from !== this.creator && message.from !== this.me
            )
            .at(-1)?.id);
    await this.learning.feedback(candidate, referenced);
    if (this.work.inject(key, [entry])) {
      await this.learning.woke([entry.id]);
      await this.learning.record({
        kind: 'injected',
        message_id: entry.id,
        conversation: key,
      });
      return;
    }
    if (decision.relevant) await this.lanes.push(key, entry);
  }
  /** Shared admission and regression replay; protected messages always wake. */
  evaluate(
    candidate: Candidate,
    probabilities?: Record<string, number>
  ): Promise<Decision> {
    return this.filter.evaluate(candidate, probabilities);
  }
  checkFixture(fixture: MustWakeFixture): Promise<boolean> {
    return this.filter.checkFixture(fixture);
  }
  private async onGenericEvent(
    id: string,
    type: string,
    metadata: unknown,
    posted?: MessagePosted
  ): Promise<void> {
    const channel = posted
      ? `event:${posted.parent.type}:${posted.parent.id}`
      : typeof metadata === 'object' &&
          metadata !== null &&
          'channel_id' in metadata &&
          typeof metadata.channel_id === 'string'
        ? metadata.channel_id
        : `event:${type}`;
    const entry: Entry = {
      id: posted?.message_id ?? id,
      eventType: type,
      channelId: channel,
      channel: channel,
      root: id,
      thread: null,
      dm: false,
      from: posted?.sender ?? 'event',
      at: new Date().toISOString(),
      text: JSON.stringify({ event_type: type, metadata }),
      mentionsMe: posted ? this.mentionsMe(posted) : false,
    };
    const candidate: Candidate = {
      messageId: entry.id,
      eventType: type,
      channel,
      directMessage: false,
      mentionsMe: entry.mentionsMe,
      fromCreator: entry.from === this.creator,
      inMyThread: false,
      message: {
        id: entry.id,
        text: entry.text,
        at: entry.at,
        from: entry.from,
        thread: null,
      },
      recent: [],
    };
    const decision = await this.evaluate(candidate);
    await this.learning.decided(candidate, decision, type);
    if (posted)
      await this.learning.feedback(
        candidate,
        posted.thread_id ??
          (posted.root_id !== posted.message_id ? posted.root_id : undefined)
      );
    if (decision.relevant) await this.lanes.push(channel, entry);
  }
  /** A normal work-tier task owns its branch and checks before merging any narrowing. */
  async tune(): Promise<void> {
    if (this.tuneRunning || this.draining) return;
    this.tuneRunning = true;
    try {
      await this.work.start(
        { channel: 'internal:tune', root: null },
        'Tune relevance',
        `${TUNE_TASK}\nMain workspace: ${this.workspace.root}`,
        { report: false }
      );
      await this.learning.tuned();
    } finally {
      this.tuneRunning = false;
    }
  }
  private async catchUp(since: Date): Promise<void> {
    for (const channelId of await this.history.channels()) {
      const page = await this.deps.http.channelMessages(channelId, {
        activity_after: since.toISOString(),
        limit: 50,
      });
      const missed = missedMessages(channelId, page, since, (id) =>
        this.seen.has(id)
      );
      this.log({ caught_up: channelId, missed: missed.length });
      for (const posted of missed) await this.onMessage(posted);
    }
  }
  /** A respond turn for one lane's batch. Typing shows from start until the first post. */
  private async respond(lane: string, batch: Entry[]): Promise<void> {
    const last = batch.at(-1);
    if (!last) return;
    const conversation: Conversation = {
      channel: last.channelId,
      root: last.dm ? null : last.root,
    };
    if (this.work.inject(lane, batch)) return;
    const persona = await this.workspace.persona();
    const protectedFixture = (
      await Promise.all(
        batch.map((entry) => this.learning.isProtected(entry.id))
      )
    ).some(Boolean);
    const protectedBatch =
      protectedFixture ||
      batch.some(
        (entry) => entry.dm || entry.mentionsMe || entry.from === this.creator
      );
    if (this.wiring.learning && !protectedBatch) {
      const triage = await this.pool.start({
        id: `triage-${crypto.randomUUID()}`,
        tier: 'triage',
        lane,
        prompt: `Is this batch worth a real turn for this agent? Reply only WAKE or IGNORE. Never use tools.\n${JSON.stringify(batch)}`,
        system: persona.operating,
        model: this.wiring.learning.triageModel,
        tools: [],
        builtinTools: [],
        strictMcpConfig: true,
        cwd: this.workspace.root,
        env: this.deps.baseEnv,
      });
      const judged = await triage.done;
      const worthy =
        judged.status === 'success' && /^WAKE\b/i.test(judged.result.trim());
      await this.learning.record({
        kind: 'triage',
        message_ids: batch.map((entry) => entry.id),
        woke: worthy,
        ignored: !worthy,
        status: judged.status,
      });
      if (!worthy) return;
    }
    const turnId = `respond-${stamp()}-${lane.slice(0, 8)}`;
    this.turnSources.set(
      turnId,
      batch.map((entry) => entry.id)
    );
    const prompt = respondPrompt({
      instructions: persona.prompts.respond,
      talk: talkCommands(this.deps.exe, 'respond'),
      batch,
      history: await this.history.recent(last.channelId, PROMPT_HISTORY),
      inFlight: this.work.inFlight(),
    });
    // Typing starts before the turn so even its first post finds it on; the
    // post stops it, and so does the turn ending.
    const stopTyping = last.channelId.startsWith('event:')
      ? async () => {}
      : startTyping(
          (active) =>
            this.deps.http.typing(
              conversation.channel,
              conversation.root ?? undefined,
              active
            ),
          {
            log: (line) => this.log(line),
          }
        );
    this.typing.set(turnId, stopTyping);
    let handle: RunHandle;
    try {
      handle = await this.startTurn(
        (await this.wiring.route?.({ kind: 'respond', lane, batch })) ??
          'respond',
        turnId,
        prompt,
        persona.operating,
        persona.events.model,
        lane
      );
    } catch (error) {
      await stopTyping();
      this.typing.delete(turnId);
      throw error;
    }
    const timeout = setTimeout(
      () => handle.abort(),
      persona.events.respondTimeoutMinutes * 60000
    );
    let outcome: Awaited<RunHandle['done']>;
    try {
      await this.learning.woke(batch.map((entry) => entry.id));
      outcome = await handle.done;
    } catch (error) {
      await this.learning.outcome(
        batch.map((entry) => entry.id),
        turnId,
        'error',
        this.postedTurns.delete(turnId),
        this.reactedTurns.delete(turnId)
      );
      throw error;
    } finally {
      clearTimeout(timeout);
      await stopTyping();
      this.typing.delete(turnId);
      this.turnSources.delete(turnId);
    }
    await this.learning.outcome(
      batch.map((entry) => entry.id),
      turnId,
      outcome.status,
      this.postedTurns.delete(turnId),
      this.reactedTurns.delete(turnId)
    );
    this.turnSources.delete(turnId);
    if (
      this.wiring.learning &&
      (await this.learning.tuneDue(this.wiring.learning.wakesPerTune))
    )
      await this.tune().catch((error) =>
        this.log({ tune_failed: String(error) })
      );
    for (const item of batch)
      await this.appendLog('handled.jsonl', {
        message_id: item.id,
        turn: turnId,
        status: outcome.status,
      });
    await this.writer.commitTurn(
      turnId,
      `respond in ${last.channel || last.channelId}: ${outcome.status}`
    );
    if (outcome.status === 'error')
      throw new Error(`respond turn ${turnId} failed: ${outcome.result}`);
  }
  private async startTurn(
    tier: Tier,
    turnId: string,
    prompt: string,
    system: string,
    model: string,
    lane?: string
  ) {
    try {
      const handle = await this.pool.start({
        id: turnId,
        tier,
        lane,
        prompt,
        system,
        model,
        cwd: this.workspace.root,
        env: this.turnEnv(turnId),
      });
      this.problems.delete('budget');
      return handle;
    } catch (error) {
      this.problems.add('budget');
      throw error;
    }
  }
  /** A heartbeat turn when the snapshot changed, a sweep is due, or `forced` names a reason. */
  async heartbeat(forced: string | null): Promise<void> {
    if (this.heartbeatRunning && forced === null) return;
    this.heartbeatRunning = true;
    try {
      const persona = await this.workspace.persona();
      if (this.wiring.learning)
        await this.learning
          .pollReactions(this.deps.http, this.me)
          .catch((error) =>
            this.log({ reaction_feedback_failed: String(error) })
          );
      const snapshot = snapshotText({
        self: await this.memory.self(),
        schedules: await this.scheduleBook.list(),
        work: this.work.inFlight(),
      });
      const hash = await snapshotHash(snapshot);
      const last = await this.heartbeatStore.read();
      const nowSeconds = Math.floor(Date.now() / 1000);
      const reason =
        forced ??
        wakeReason({
          hash,
          lastHash: last.hash,
          nowSeconds,
          lastRunSeconds: last.lastRunSeconds,
          sweepHours: persona.events.sweepHours,
        });
      if (reason === null) return;
      const turnId = `heartbeat-${stamp()}`;
      const prompt = heartbeatPrompt({
        instructions: persona.prompts.heartbeat,
        talk: talkCommands(this.deps.exe, 'heartbeat'),
        reason,
        snapshot,
        now: new Date(),
      });
      const handle = await this.startTurn(
        (await this.wiring.route?.({ kind: 'heartbeat', reason })) ??
          'heartbeat',
        turnId,
        prompt,
        persona.operating,
        persona.events.model
      );
      const outcome = await handle.done;
      await this.heartbeatStore.write({ hash, lastRunSeconds: nowSeconds });
      await this.writer.commitTurn(
        turnId,
        `heartbeat (${reason}): ${outcome.status}`
      );
    } finally {
      this.heartbeatRunning = false;
    }
  }
  /** Post in a conversation as the agent; stops the turn's typing and records what was said. */
  private async say(
    turn: string | null,
    conversation: Conversation,
    text: string
  ): Promise<PostResult> {
    const send: OutboundNext = async (outbound) => {
      const message = await this.deps.http.post(
        outbound.channel,
        outbound.text,
        outbound.root ?? undefined
      );
      await this.memory.said(conversationKey(outbound), outbound.text);
      if (outbound.turn) this.postedTurns.add(outbound.turn);
      await this.learning.posted(
        message.id,
        outbound.turn ? (this.turnSources.get(outbound.turn) ?? []) : [],
        outbound.channel
      );
      return { id: message.id };
    };
    const pipeline = (this.wiring.outbound ?? []).reduceRight<OutboundNext>(
      (next, middleware) => (message) => middleware(message, next),
      send
    );
    try {
      return await pipeline({ ...conversation, turn, text });
    } finally {
      if (turn) await this.typing.get(turn)?.();
    }
  }
  /** Return true when a composition handles a routine wake entirely in code. */
  async onSchedule(wake: import('./schedules.ts').Wake): Promise<boolean> {
    return (
      this.wiring.onSchedule !== undefined &&
      (await this.wiring.onSchedule(wake, this)) !== false
    );
  }
  /** Call adapters dispatch lifecycle events here; transports are supplied separately. */
  async onCall(call: BrainCall): Promise<void> {
    if (this.draining && call.phase !== 'ended')
      throw new Error('brain is draining for reload');
    if (this.wiring.onCall) await this.wiring.onCall(call, this);
    else if (call.phase === 'incoming') await this.joinCall(call);
  }

  /** Join with the shared persona, memory and work tier. Hooks may change call policy. */
  async joinCall(call: BrainCall, policy: CallPolicy = {}): Promise<void> {
    const transport = this.deps.calls;
    if (!transport) throw new Error('no call transport is installed');
    await transport.join(
      call,
      {
        context: async () => {
          const persona = await this.workspace.persona();
          const name = /^# (.+)$/m.exec(persona.operating)?.[1];
          if (!name)
            throw new Error('OPERATING.md must start with the agent name');
          return {
            name,
            operating: persona.operating,
            model: persona.events.model,
            voice: parseVoiceConfig(
              JSON.parse(await this.writer.readRemote('config/voice.json'))
            ).model,
            briefing: JSON.stringify({
              self: await this.memory.self(),
              notes: await this.memory.recall(''),
            }),
            budgetUsd: Math.min(
              persona.budget.perRunUsd.respond,
              persona.budget.perDayUsd - (await this.ledger.spentToday())
            ),
          };
        },
        handOff: async (channel, task) =>
          (await this.handoff({ channel, root: null }, 'Work from call', task))
            .taskId,
        finished: async (id, channel, summary) => {
          await this.memory.remember(`call-${id}`, summary);
          if (channel)
            await this.post(null, channel, `Call summary: ${summary}`);
          await this.writer.commitTurn(`call-${id}`, 'remember call summary');
        },
        hungUp: async (id) => {
          let ids: string[] = [];
          try {
            ids = JSON.parse(
              await readFile(
                this.workspace.path('cache/call-hungup.json'),
                'utf8'
              )
            );
          } catch (error) {
            if (
              !(
                error instanceof Error &&
                'code' in error &&
                error.code === 'ENOENT'
              )
            )
              throw error;
          }
          await this.writer.write(
            'cache/call-hungup.json',
            JSON.stringify([...new Set([...ids, id])].slice(-50))
          );
        },
        spent: async (usd) => {
          await this.ledger.record(usd);
        },
      },
      policy
    );
  }
  // Control: what turns and macrod call.
  async health(): Promise<Health> {
    const problems = [...this.problems];
    if (!this.connected) problems.push('event stream disconnected');
    const state = problems.length === 0 ? 'ok' : 'degraded';
    const persona = await this.workspace.persona();
    const filterSize =
      new Set([...persona.events.events, ...(this.wiring.subscriptions ?? [])])
        .size + Object.keys(persona.jev.questions).length;
    const wakeRate = this.learning.stats().wakeRate;
    startSpan('brain.filter.metrics', {
      'filter.size': filterSize,
      'filter.wake_rate': wakeRate,
    }).end();
    if (this.previousHealth !== state) {
      const span = startSpan('brain.health', {
        'health.state': state,
        'health.connected': this.connected,
        'health.problem_count': problems.length,
      });
      if (state !== 'ok') span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      this.previousHealth = state;
    }
    return {
      status: problems.length === 0 ? 'ok' : 'degraded',
      startedAt: this.startedAt,
      connected: this.connected,
      lastEventAt: this.lastEventAt,
      lastTurnAt: this.pool?.lastTurnAt() ?? null,
      turns: this.pool?.active() ?? [],
      work: this.work?.inFlight() ?? [],
      spentTodayUsd: await this.ledger.spentToday(),
      filterSize,
      wakeRate,
      problems,
    };
  }
  async react(
    turn: string | null,
    channel: string,
    message: string,
    emoji: string
  ): Promise<void> {
    await this.deps.http.react(channel, message, emoji);
    if (turn) this.reactedTurns.add(turn);
    await this.learning.record({
      kind: 'reacted',
      message_id: message,
      turn,
      reacted: true,
    });
  }
  post(turn: string | null, channel: string, text: string) {
    return this.say(turn, { channel, root: null }, text);
  }
  reply(turn: string | null, channel: string, root: string, text: string) {
    return this.say(turn, { channel, root }, text);
  }
  async context(channel: string, root: string | null): Promise<unknown[]> {
    const page = await this.deps.http.channelMessages(
      channel,
      root ? { ids: [root], limit: 1 } : { limit: PROMPT_HISTORY }
    );
    const line = (message: {
      id: string;
      sender_id: string;
      created_at: string;
      content: string;
    }) => ({
      id: message.id,
      from: message.sender_id,
      at: message.created_at,
      text: message.content,
    });
    if (root)
      return page.flatMap((message) => [
        line(message),
        ...(message.thread?.preview ?? []).map(line),
      ]);
    return page.reverse().map(line);
  }
  async handoff(conversation: Conversation, label: string, task: string) {
    if (this.draining) throw new Error('brain is draining for reload');
    const created = await this.work.start(conversation, label, task);
    return { taskId: created.id };
  }
  remember(topic: string, text: string) {
    return this.memory.remember(topic, text);
  }
  recall(query: string) {
    return this.memory.recall(query);
  }
  forget(topic: string) {
    return this.memory.forget(topic);
  }
  focus(focus: string) {
    return this.memory.setFocus(focus);
  }
  promise(what: string, to: string, conversation: string | null) {
    return this.memory.commit({ what, to, conversation });
  }
  async release(match: string) {
    return { released: await this.memory.release(match) };
  }
  schedule(note: string, trigger: Trigger) {
    return this.scheduleBook.create(note, trigger);
  }
  schedules() {
    return this.scheduleBook.list();
  }
  unschedule(routineId: string) {
    return this.scheduleBook.delete(routineId);
  }
}

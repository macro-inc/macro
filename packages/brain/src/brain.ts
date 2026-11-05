// The running brain: events in, Jev, lanes, tiered turns, commits out.
//
// message.posted → history → (work running in that conversation? inject) →
// Jev → the conversation's lane → a respond turn. The heartbeat and schedule
// wake-ups start heartbeat turns; hand-offs start work turns. Every turn
// commits the workspace when it ends.
import { join } from 'node:path';
import { SpanStatusCode } from '@opentelemetry/api';
import { SpendLedger } from './budget.ts';
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
} from './events.ts';
import {
  HeartbeatStore,
  snapshotHash,
  snapshotText,
  wakeReason,
} from './heartbeat.ts';
import { type Entry, History } from './history.ts';
import { judge } from './jev.ts';
import { Lanes } from './lanes.ts';
import type { ChannelDetail, MacroHttp } from './macro.ts';
import { Memory } from './memory.ts';
import { Pool } from './pool.ts';
import { type OpenSocket, startTyping, stayOnline } from './presence.ts';
import {
  heartbeatPrompt,
  respondPrompt,
  talkCommands,
  workPrompt,
} from './prompts.ts';
import type { RunHandle, Runner, Tier } from './runner.ts';
import { type Routines, Schedules, type Trigger } from './schedules.ts';
import { startSpan } from './telemetry.ts';
import { conversationKey, type Tasks, Work } from './work.ts';
import { type Git, GitWriter, Workspace } from './workspace.ts';

export type BrainDeps = {
  config: Config;
  http: MacroHttp;
  tasks: Tasks;
  routines: Routines;
  runner: Runner;
  git: Git;
  openSocket: OpenSocket;
  /** The `brain` executable turns call. */
  exe: string;
  /** PATH and HOME for turns. */
  baseEnv: Record<string, string>;
  log(line: object): void;
};

const RELEVANCE_CONTEXT = 6;
const PROMPT_HISTORY = 20;
const SEEN_LIMIT = 5_000;

const stamp = () => new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);

export class Brain implements Control {
  readonly workspace: Workspace;
  private readonly writer: GitWriter;
  private readonly memory: Memory;
  private readonly history: History;
  private readonly ledger: SpendLedger;
  private readonly heartbeatStore: HeartbeatStore;
  private readonly controlToken = crypto.randomUUID();
  private readonly channels = new Map<string, ChannelDetail>();
  private readonly seen = new Set<string>();
  private readonly typing = new Map<string, () => Promise<void>>();
  private readonly startedAt = new Date().toISOString();
  private readonly problems = new Set<string>();

  private me = '';
  private connected = false;
  private lastEventAt: string | null = null;
  private heartbeatRunning = false;
  private pool!: Pool;
  private work!: Work;
  private lanes!: Lanes<Entry>;
  private scheduleBook!: Schedules;

  constructor(private readonly deps: BrainDeps) {
    this.workspace = new Workspace(deps.config.workspace);
    this.writer = new GitWriter(this.workspace, deps.git);
    this.memory = new Memory(this.workspace, this.writer);
    this.history = new History(this.workspace.path('history'));
    this.ledger = new SpendLedger(this.workspace.path('cache'));
    this.heartbeatStore = new HeartbeatStore(this.workspace.path('cache'));
  }

  private previousHealth: string | undefined;

  private log(line: object) {
    this.deps.log(line);
  }

  private async appendLog(name: string, line: object) {
    const dir = this.workspace.path('log');
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(
      join(dir, name),
      `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`,
      { append: true }
    );
  }

  /** Run until `signal` aborts. Startup fails loudly on a broken persona or an unreachable Macro. */
  async run(signal: AbortSignal): Promise<void> {
    await this.workspace.enforceGitignore();
    const persona = await this.workspace.persona();
    this.me = (await this.deps.http.me()).user_id;
    this.log({ brain: 'starting', me: this.me, brain_lock: persona.brainLock });

    this.pool = new Pool({
      runner: this.deps.runner,
      limits: persona.events.concurrency,
      budget: async () => (await this.workspace.persona()).budget,
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
    this.lanes = new Lanes<Entry>(
      this.workspace.path('cache', 'lanes'),
      (lane, batch) => this.respond(lane, batch),
      (line) => this.log(line)
    );

    const resumed = await this.lanes.resume();
    if (resumed > 0) this.log({ lanes_resumed: resumed });

    const server = Deno.serve(
      {
        hostname: '127.0.0.1',
        port: this.deps.config.healthPort,
        signal,
        onListen: () => {},
      },
      controlHandler(this, this.controlToken, (line) => this.log(line))
    );
    const offline = stayOnline({
      url: this.deps.config.hosts.connection,
      apiKey: this.deps.config.macroApiKey,
      open: this.deps.openSocket,
      log: (line) => this.log(line),
    });
    const heartbeat = setInterval(
      () =>
        this.heartbeat(null).catch((error) =>
          this.log({ heartbeat_failed: String(error) })
        ),
      persona.events.heartbeatMinutes * 60_000
    );
    this.scheduleBook
      .reconcile()
      .catch((error) =>
        this.log({ schedules_reconcile_failed: String(error) })
      );

    const filters = [
      {
        events: [
          MESSAGE_POSTED,
          AGENT_SESSION_OPENED,
          ...persona.events.events,
        ],
      },
    ];
    const stream = eventStream(
      {
        open: (connection) =>
          this.deps.http.openEventStream(filters, connection),
        sleep: abortableSleep,
        log: (line) => {
          const state = 'events' in line ? line.events : null;
          if (state === 'connected') this.connected = true;
          if (state === 'failed' || state === 'ended') this.connected = false;
          this.log(line);
        },
      },
      signal
    );

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
        if (event.type === MESSAGE_POSTED) {
          await this.onMessage(event.metadata).catch((error) =>
            this.log({
              message_id: event.metadata.message_id,
              handle_failed: String(error),
            })
          );
        } else if (event.type === AGENT_SESSION_OPENED) {
          const wake = await this.scheduleBook.wakeFor(event.metadata, this.me);
          if (wake) {
            const reason = wake.schedule
              ? `schedule: ${wake.schedule.note}`
              : `a routine run with no schedule record: ${wake.sessionName}`;
            this.heartbeat(reason).catch((error) =>
              this.log({ heartbeat_failed: String(error) })
            );
          }
        }
      }
    } finally {
      clearInterval(heartbeat);
      offline();
      await this.work.stopAll();
      await this.lanes.shutdown();
      await server.finished;
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
    if (entry.from === this.me || entry.from.startsWith('bot|')) return;

    const key = conversationKey({
      channel: entry.channelId,
      root: dm ? null : entry.root,
    });
    if (this.work.inject(key, [entry])) {
      this.log({ message_id: entry.id, injected_into_work: key });
      return;
    }

    const judged = (message: Entry) => ({
      id: message.id,
      from: message.from,
      at: message.at,
      text: message.text,
      thread: message.thread,
    });
    const decision = await judge(
      {
        messageId: entry.id,
        channel: entry.channel,
        mentionsMe: entry.mentionsMe,
        directMessage: dm,
        inMyThread: recent.some(
          (message) => message.from === this.me && message.root === entry.root
        ),
        message: judged(entry),
        recent: recent.map(judged),
      },
      {
        config: () => this.workspace.jev(),
        decide: (request) => this.deps.http.decide(request),
        log: (line) => this.appendLog('decisions.jsonl', line),
      }
    );
    if (decision.relevant) await this.lanes.push(key, entry);
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
    const turnId = `respond-${stamp()}-${lane.slice(0, 8)}`;
    const prompt = respondPrompt({
      instructions: persona.prompts.respond,
      talk: talkCommands(this.deps.exe, 'respond'),
      batch,
      history: await this.history.recent(last.channelId, PROMPT_HISTORY),
      inFlight: this.work.inFlight(),
    });

    // Typing starts before the turn so even its first post finds it on; the
    // post stops it, and so does the turn ending.
    const stopTyping = startTyping(
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
      persona.events.respondTimeoutMinutes * 60_000
    );

    const outcome = await handle.done;
    clearTimeout(timeout);
    await stopTyping();
    this.typing.delete(turnId);

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
  ): Promise<{ id: string }> {
    const message = await this.deps.http.post(
      conversation.channel,
      text,
      conversation.root ?? undefined
    );
    if (turn) await this.typing.get(turn)?.();
    await this.memory.said(conversationKey(conversation), text);
    return { id: message.id };
  }

  // Control: what turns and macrod call.

  async health(): Promise<Health> {
    const problems = [...this.problems];
    if (!this.connected) problems.push('event stream disconnected');
    const state = problems.length === 0 ? 'ok' : 'degraded';
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
      problems,
    };
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

  secret(name: string) {
    return this.deps.http.secret(name);
  }
}

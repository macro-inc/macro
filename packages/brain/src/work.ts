// Work: a hand-off from a respond turn becomes a Macro task assigned to the
// agent and a work run in its own git worktree (work/<task>/). The run is
// registered under its originating conversation, so follow-ups there are
// injected into it; its final message is posted back there as the report.
import type { Conversation } from './control.ts';
import type { Entry } from './history.ts';
import type { Pool } from './pool.ts';
import { followUp, type InFlight } from './prompts.ts';
import type { Outcome, RunHandle, Tier } from './runner.ts';
import type { Git } from './workspace.ts';
export type CreatedTask = {
  id: string;
  url: string;
};
export interface Tasks {
  /** Create a task assigned to the agent. */
  create(name: string, markdown: string): Promise<CreatedTask>;
}
/** The lane key of a conversation: a DM is the channel, a thread is channel + root. */
export const conversationKey = (conversation: Conversation) =>
  conversation.root
    ? `${conversation.channel}.${conversation.root}`
    : conversation.channel;
type Running = InFlight & {
  handle: RunHandle;
  conversationRef: Conversation;
  report: boolean;
};
export type WorkDeps = {
  pool: Pool;
  /** Work runs allowed at once; a hand-off past it is refused, never queued behind a respond timeout. */
  limit: number;
  tasks: Tasks;
  git: Git;
  /** Absolute path of the workspace's work/ directory. */
  workDir: string;
  /** Build the work run's prompt and system text. */
  turn(
    task: CreatedTask,
    conversation: Conversation,
    description: string
  ): Promise<{
    tier?: Tier;
    prompt: string;
    system: string;
    model: string;
    env: Record<string, string>;
  }>;
  /** Post the report (holding the speaking gate). */
  report(conversation: Conversation, text: string): Promise<void>;
  /** Commit after the run. */
  commit(turnId: string, summary: string): Promise<unknown>;
  log(line: object): void;
};
export class Work {
  private readonly deps: WorkDeps;
  private readonly running = new Map<string, Running>();
  /** Conversations whose hand-off is being set up, so a second one can't race it. */
  private readonly starting = new Set<string>();
  private readonly launches = new Set<Promise<CreatedTask>>();
  private draining = false;
  /** Runs reporting, committing and cleaning up after they end. */
  private readonly finishing = new Set<Promise<void>>();
  constructor(deps: WorkDeps) {
    this.deps = deps;
  }
  inFlight(): InFlight[] {
    return [...this.running.values()].map(
      ({ conversation, taskId, label, startedAt }) => ({
        conversation,
        taskId,
        label,
        startedAt,
      })
    );
  }
  /** Inject follow-ups into the work running for this conversation; false when none is. */
  inject(key: string, entries: Entry[]): boolean {
    const run = this.running.get(key);
    if (!run) return false;
    try {
      run.handle.inject(followUp(entries));
      return true;
    } catch (error) {
      // The run finished between the check and the inject: the caller answers instead.
      this.deps.log({ work: run.taskId, inject_failed: String(error) });
      return false;
    }
  }
  /** Start a work run; resolves once it is running, not when it finishes. */
  async start(
    conversation: Conversation,
    label: string,
    description: string,
    options: { report?: boolean } = {}
  ): Promise<CreatedTask> {
    if (this.draining) throw new Error('work is draining');
    const key = conversationKey(conversation);
    const existing = this.running.get(key);
    if (existing || this.starting.has(key)) {
      throw new Error(
        `work "${existing?.label ?? label}" is already running for this conversation; follow-ups go to it`
      );
    }
    if (this.running.size + this.starting.size >= this.deps.limit) {
      throw new Error(
        `already running ${this.running.size} work runs, the limit; finish or stop one first`
      );
    }
    this.starting.add(key);
    const launching = this.launch(
      key,
      conversation,
      label,
      description,
      options.report ?? true
    );
    this.launches.add(launching);
    try {
      return await launching;
    } finally {
      this.starting.delete(key);
      this.launches.delete(launching);
    }
  }
  private async launch(
    key: string,
    conversation: Conversation,
    label: string,
    description: string,
    report: boolean
  ): Promise<CreatedTask> {
    const task = await this.deps.tasks.create(label, description);
    const worktree = `${this.deps.workDir}/${task.id}`;
    const branch = `work/${task.id}`;
    const added = await this.deps.git([
      'worktree',
      'add',
      '-q',
      '-b',
      branch,
      worktree,
      'HEAD',
    ]);
    if (added.code !== 0)
      throw new Error(
        `could not create the worktree for task ${task.id}: ${added.stderr.trim()}`
      );
    const turnId = `work-${task.id}`;
    const { prompt, system, model, env, tier } = await this.deps.turn(
      task,
      conversation,
      description
    );
    let handle: RunHandle;
    try {
      handle = await this.deps.pool.start({
        id: turnId,
        tier: tier ?? 'work',
        prompt,
        system,
        model,
        cwd: worktree,
        env,
      });
    } catch (error) {
      await this.cleanUp(worktree, branch);
      throw error;
    }
    this.running.set(key, {
      conversation: key,
      conversationRef: conversation,
      report,
      taskId: task.id,
      label,
      startedAt: new Date().toISOString(),
      handle,
    });
    this.deps.log({ work: task.id, started: label, conversation: key });
    const finished = handle.done
      .then((outcome) => this.finish(key, turnId, outcome, worktree, branch))
      .catch((error) =>
        this.deps.log({ work: task.id, finish_failed: String(error) })
      )
      .finally(() => this.finishing.delete(finished));
    this.finishing.add(finished);
    return task;
  }
  /** Stop admissions and finish starts already underway, then all active turns. */
  async drain(): Promise<void> {
    this.draining = true;
    await Promise.allSettled(this.launches);
    await this.settled();
  }
  /** Abort every running work run and wait for them to report and clean up (shutdown). */
  async stopAll(): Promise<void> {
    for (const run of this.running.values()) run.handle.abort();
    await this.settled();
  }
  /** Wait until every ended run has reported, committed and cleaned up. */
  async settled(): Promise<void> {
    while (this.finishing.size > 0) await Promise.all(this.finishing);
  }
  private async finish(
    key: string,
    turnId: string,
    outcome: Outcome,
    worktree: string,
    branch: string
  ) {
    const run = this.running.get(key);
    this.running.delete(key);
    if (!run) return;
    const report =
      outcome.status === 'success'
        ? outcome.result
        : `I couldn't finish "${run.label}" (${outcome.status}${outcome.result ? `: ${outcome.result}` : ''}).`;
    if (run.report) await this.deps.report(run.conversationRef, report);
    await this.deps.commit(turnId, `work ${run.label}: ${outcome.status}`);
    await this.cleanUp(worktree, branch);
  }
  /** Remove the worktree and branch unless they hold uncommitted or unmerged work. */
  private async cleanUp(worktree: string, branch: string) {
    const removed = await this.deps.git(['worktree', 'remove', worktree]);
    if (removed.code !== 0) {
      this.deps.log({ worktree, kept: removed.stderr.trim() });
      return;
    }
    const deleted = await this.deps.git(['branch', '-d', branch]);
    if (deleted.code !== 0)
      this.deps.log({ branch, kept: deleted.stderr.trim() });
  }
}

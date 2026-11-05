/** Decision history and durable must-wake examples. Message text stays in the workspace. */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import type { Candidate, Decision } from './jev.ts';
import { readJsonl } from './lanes.ts';
import { type MacroHttp, MacroHttpError } from './macro.ts';
import { startSpan, withSpan } from './telemetry.ts';
import type { GitWriter, Workspace } from './workspace.ts';

export type MustWakeFixture = {
  eventType: string;
  candidate: Candidate;
  probabilities: Record<string, number>;
  reason: 'creator' | 'direct_message' | 'mentioned' | 'useful' | 'missed';
};
export type LearningConfig = { wakesPerTune: number; triageModel: string };
type Remembered = {
  candidate: Candidate;
  decision: Decision;
  eventType: string;
};
const key = (id: string) => createHash('sha256').update(id).digest('hex');

export async function fixtures(root: string): Promise<MustWakeFixture[]> {
  const found = new Map<string, MustWakeFixture>();
  for (const directory of ['brain/fixtures', 'cache/brain-regressions']) {
    try {
      for (const file of await fs.readdir(join(root, directory))) {
        if (!file.endsWith('.json')) continue;
        const fixture: MustWakeFixture = JSON.parse(
          await fs.readFile(join(root, directory, file), 'utf8')
        );
        if (
          !fixture.candidate?.messageId ||
          typeof fixture.eventType !== 'string'
        )
          throw new Error(`invalid must-wake fixture: ${file}`);
        found.set(fixture.candidate.messageId, fixture);
      }
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
      )
        throw error;
    }
  }
  return [...found.values()];
}

export class Learning {
  private decisions = 0;
  private wakes = 0;
  private lastTune = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly workspace: Workspace;
  private readonly writer: GitWriter;
  constructor(workspace: Workspace, writer: GitWriter) {
    this.workspace = workspace;
    this.writer = writer;
  }
  async resume(): Promise<void> {
    const log = await readJsonl<{ kind: string; count?: number }>(
      this.workspace.path('log/decisions.jsonl')
    );
    this.decisions = log.filter((entry) => entry.kind === 'decision').length;
    this.wakes = log
      .filter((entry) => entry.kind === 'wake')
      .reduce((sum, entry) => sum + (entry.count ?? 1), 0);
    this.lastTune =
      log.filter((entry) => entry.kind === 'tune').at(-1)?.count ?? 0;
    for (const fixture of await fixtures(this.workspace.root))
      await this.writer.write(
        `cache/brain-regressions/${key(fixture.candidate.messageId)}.json`,
        JSON.stringify(fixture)
      );
  }
  stats() {
    return {
      decisions: this.decisions,
      wakes: this.wakes,
      wakeRate: this.decisions ? this.wakes / this.decisions : 0,
    };
  }
  /** Serialized append: never export message content to logs sent to telemetry. */
  record(line: object): Promise<void> {
    const step = this.tail.then(async () => {
      await fs.mkdir(this.workspace.path('log'), { recursive: true });
      await fs.appendFile(
        this.workspace.path('log/decisions.jsonl'),
        `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`
      );
    });
    this.tail = step.catch(() => {});
    return step;
  }
  async decided(
    candidate: Candidate,
    decision: Decision,
    eventType = 'message.posted'
  ): Promise<void> {
    await withSpan(
      'brain.learning.decision',
      { 'learning.admitted': decision.relevant },
      async () => {
        this.decisions++;
        await this.writer.write(
          `cache/learning/messages/${key(candidate.messageId)}.json`,
          JSON.stringify({ candidate, decision, eventType })
        );
        await this.record({
          kind: 'decision',
          message_id: candidate.messageId,
          event_type: eventType,
          admitted: decision.relevant,
          reason: decision.reason,
          probabilities: decision.probabilities,
        });
        if (candidate.fromCreator)
          await this.protect(candidate.messageId, 'creator');
        else if (candidate.directMessage)
          await this.protect(candidate.messageId, 'direct_message');
        else if (candidate.mentionsMe)
          await this.protect(candidate.messageId, 'mentioned');
      }
    );
  }
  async isProtected(id: string): Promise<boolean> {
    try {
      await fs.access(
        this.workspace.path(`cache/brain-regressions/${key(id)}.json`)
      );
      return true;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return false;
      throw error;
    }
  }
  async protect(id: string, reason: MustWakeFixture['reason']): Promise<void> {
    const remembered = await this.message(id);
    if (!remembered) return;
    const fixture: MustWakeFixture = {
      candidate: remembered.candidate,
      probabilities: remembered.decision.probabilities,
      eventType: remembered.eventType,
      reason,
    };
    const text = `${JSON.stringify(fixture, null, 2)}\n`;
    await this.writer.write(`brain/fixtures/${key(id)}.json`, text);
    // Independent replay keeps the union even when a proposed change deletes fixtures.
    await this.writer.write(`cache/brain-regressions/${key(id)}.json`, text);
  }
  private async message(id: string): Promise<Remembered | null> {
    try {
      return JSON.parse(
        await fs.readFile(
          this.workspace.path(`cache/learning/messages/${key(id)}.json`),
          'utf8'
        )
      );
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return null;
      throw error;
    }
  }
  async woke(ids: string[]): Promise<void> {
    this.wakes += ids.length;
    const span = startSpan('brain.learning.wake', {
      'learning.wakes': this.wakes,
      'learning.decisions': this.decisions,
      'learning.wake_rate': this.stats().wakeRate,
    });
    span.end();
    await this.record({
      kind: 'wake',
      message_ids: ids,
      count: ids.length,
      woke: true,
    });
  }
  async outcome(
    ids: string[],
    turn: string,
    status: string,
    posted: boolean,
    reacted = false
  ): Promise<void> {
    await this.record({
      kind: 'outcome',
      message_ids: ids,
      turn,
      status,
      posted,
      reacted,
      ignored: !posted && !reacted,
    });
    if ((posted || reacted) && status === 'success')
      for (const id of ids) await this.protect(id, 'useful');
  }
  async posted(id: string, sources: string[], channel: string): Promise<void> {
    await this.writer.write(
      `cache/learning/posts/${key(id)}.json`,
      JSON.stringify({ id, channel, sources, reactions: [] })
    );
    await this.record({
      kind: 'posted',
      message_id: id,
      sources,
      posted: true,
    });
  }
  async reaction(id: string, positive: boolean): Promise<void> {
    let sources: string[];
    try {
      const post: { sources: string[] } = JSON.parse(
        await fs.readFile(
          this.workspace.path(`cache/learning/posts/${key(id)}.json`),
          'utf8'
        )
      );
      sources = post.sources;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return;
      throw error;
    }
    await this.record({
      kind: 'feedback',
      message_id: id,
      signal: positive ? 'positive_reaction' : 'negative_reaction',
      sources,
    });
    if (positive)
      for (const source of sources) await this.protect(source, 'useful');
  }
  /** The broker has no reaction fact yet; poll reactions on our own messages. */
  async pollReactions(http: MacroHttp, me: string): Promise<void> {
    let files: string[];
    try {
      files = await fs.readdir(this.workspace.path('cache/learning/posts'));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return;
      throw error;
    }
    for (const file of files) {
      try {
        const path = `cache/learning/posts/${file}`;
        const post: {
          id: string;
          channel: string;
          sources: string[];
          reactions: string[];
        } = JSON.parse(await fs.readFile(this.workspace.path(path), 'utf8'));
        if (!post.channel) continue;
        const reactions = await http.reactions(post.channel, post.id);
        const signals = reactions.flatMap((reaction) =>
          reaction.users
            .filter((user) => user !== me)
            .map((user) => key(`${reaction.emoji}:${user}`))
        );
        for (const reaction of reactions) {
          if (
            reaction.users.some(
              (user) =>
                user !== me &&
                !post.reactions.includes(key(`${reaction.emoji}:${user}`))
            )
          )
            await this.reaction(
              post.id,
              !/👎|thumbs_down|🛑/.test(reaction.emoji)
            );
        }
        await this.writer.write(
          path,
          JSON.stringify({ ...post, reactions: signals })
        );
      } catch (error) {
        if (
          error instanceof MacroHttpError &&
          [403, 404].includes(error.status)
        )
          await this.writer.remove(`cache/learning/posts/${file}`);
        await this.record({ kind: 'feedback_unavailable', post: file });
      }
    }
  }
  async feedback(candidate: Candidate, referenced?: string): Promise<void> {
    const text = candidate.message.text;
    const signal = /\b(stop|not (for )?you)\b/i.test(text)
      ? 'not_for_you'
      : candidate.fromCreator && /\byou missed (this|that)\b/i.test(text)
        ? 'missed'
        : candidate.fromCreator
          ? 'creator_correction'
          : null;
    if (!signal) return;
    await this.record({
      kind: 'feedback',
      message_id: candidate.messageId,
      signal,
      referenced,
    });
    if (signal === 'missed' && referenced)
      await this.protect(referenced, 'missed');
  }
  async tuneDue(every: number): Promise<boolean> {
    if (this.wakes - this.lastTune < every) return false;
    return true;
  }
  async tuned(): Promise<void> {
    this.lastTune = this.wakes;
    await this.record({ kind: 'tune', count: this.lastTune });
  }
}

export const TUNE_TASK = `Review the decisions, outcomes and feedback in the main workspace log/decisions.jsonl and the growing brain/fixtures/ regression set. Improve what wakes you, one small evidence-based step at a time: unsubscribe only from event types you consistently never act on; add deterministic rules to brain/triage.ts; then add or sharpen config/jev.json questions and threshold if needed. Preserve creator messages, DMs, mentions, useful actions and missed-message fixtures. All-mode examples have no model scores: add deterministic admits for them before introducing Jev questions; do not fabricate probabilities or edit a fixture to pass checks. Work in this task branch/worktree. Never edit main directly. Run brain check in this worktree, commit the wiring changes, then merge this branch into main only after check passes. Run brain check again on main before pushing. Never remove must-wake fixtures. Record why the change helps in memory. If there is insufficient evidence, make no filter change. Do not post a status message for this maintenance task.`;

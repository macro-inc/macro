// The agent's long-term memory, as files under memory/ in its repo: one note
// per topic (memory/notes/<topic>.md) and the self-state record
// (memory/self.json: current focus, commitments, the last thing said in each
// conversation). Every write goes through the workspace's single writer.
import type { GitWriter, Workspace } from './workspace.ts';

export type Commitment = {
  what: string;
  to: string;
  conversation: string | null;
  since: string;
};

export type SelfState = {
  focus: string;
  commitments: Commitment[];
  /** Conversation key to the last thing the agent said there. */
  lastSaid: Record<string, { at: string; text: string }>;
};

export const EMPTY_SELF: SelfState = {
  focus: '',
  commitments: [],
  lastSaid: {},
};

/** Topic names become file names: lowercase words joined by dashes. */
export function topicSlug(topic: string): string {
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug === '')
    throw new Error(`topic ${JSON.stringify(topic)} has no letters or digits`);
  return slug.slice(0, 80);
}

export type Recalled = { topic: string; lines: string[] };

const SELF = 'memory/self.json';
const LAST_SAID_LIMIT = 50;

export class Memory {
  /** Read-modify-write steps run one at a time so concurrent updates never drop each other. */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly workspace: Workspace,
    private readonly writer: GitWriter,
    private readonly now: () => Date = () => new Date()
  ) {}

  private serial<Result>(step: () => Promise<Result>): Promise<Result> {
    const next = this.tail.then(step);
    this.tail = next.catch(() => undefined);
    return next;
  }

  private notePath(topic: string) {
    return `memory/notes/${topicSlug(topic)}.md`;
  }

  /** Append a dated line to a topic's note. */
  remember(topic: string, text: string): Promise<void> {
    const path = this.notePath(topic);
    return this.serial(async () => {
      let current = `# ${topic}\n\n`;
      try {
        current = await Deno.readTextFile(this.workspace.path(path));
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      const line = `- ${this.now().toISOString().slice(0, 10)}: ${text.trim().replace(/\n+/g, ' ')}\n`;
      await this.writer.write(path, `${current}${line}`);
    });
  }

  async forget(topic: string): Promise<void> {
    await this.writer.remove(this.notePath(topic));
  }

  /** Lines in any note that contain every word of `query` (case-insensitive), grouped by topic. */
  async recall(query: string): Promise<Recalled[]> {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const found: Recalled[] = [];
    const dir = this.workspace.path('memory/notes');
    let entries: Deno.DirEntry[] = [];
    try {
      entries = await Array.fromAsync(Deno.readDir(dir));
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }

    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      if (!entry.isFile || !entry.name.endsWith('.md')) continue;
      const text = await Deno.readTextFile(`${dir}/${entry.name}`);
      const topic = entry.name.slice(0, -'.md'.length);
      const haystack = `${topic} `;
      const lines = text
        .split('\n')
        .filter((line) => line.trim() !== '' && !line.startsWith('# '))
        .filter((line) =>
          words.every((word) =>
            `${haystack}${line}`.toLowerCase().includes(word)
          )
        );
      if (lines.length > 0) found.push({ topic, lines });
    }
    return found;
  }

  async self(): Promise<SelfState> {
    let text: string;
    try {
      text = await Deno.readTextFile(this.workspace.path(SELF));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound)
        return structuredClone(EMPTY_SELF);
      throw error;
    }
    return JSON.parse(text) as SelfState;
  }

  async setFocus(focus: string): Promise<void> {
    await this.updateSelf((state) => ({ ...state, focus }));
  }

  async commit(commitment: Omit<Commitment, 'since'>): Promise<void> {
    const since = this.now().toISOString();
    await this.updateSelf((state) => ({
      ...state,
      commitments: [...state.commitments, { ...commitment, since }],
    }));
  }

  /** Drop commitments whose `what` contains `match`. */
  async release(match: string): Promise<number> {
    let dropped = 0;
    await this.updateSelf((state) => {
      const kept = state.commitments.filter(
        (commitment) => !commitment.what.includes(match)
      );
      dropped = state.commitments.length - kept.length;
      return { ...state, commitments: kept };
    });
    return dropped;
  }

  async said(conversation: string, text: string): Promise<void> {
    const at = this.now().toISOString();
    await this.updateSelf((state) => {
      const entries = Object.entries({
        ...state.lastSaid,
        [conversation]: { at, text: text.slice(0, 500) },
      });
      const newest = entries
        .sort(([, left], [, right]) => right.at.localeCompare(left.at))
        .slice(0, LAST_SAID_LIMIT);
      return { ...state, lastSaid: Object.fromEntries(newest) };
    });
  }

  private updateSelf(change: (state: SelfState) => SelfState): Promise<void> {
    return this.serial(async () => {
      const next = change(await this.self());
      await this.writer.write(SELF, `${JSON.stringify(next, null, 2)}\n`);
    });
  }
}

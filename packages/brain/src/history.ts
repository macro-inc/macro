// Per-conversation message history under history/ (never committed: it holds
// other people's messages). Bounded to the newest `limit` lines.
import { join } from 'node:path';
import { laneKey, readJsonl } from './lanes.ts';

/** One message as the brain records, judges, and shows it to turns. */
export type Entry = {
  id: string;
  channelId: string;
  channel: string;
  /** The conversation root; the message's own id for a root. */
  root: string;
  /** The thread root for a reply, null for a root message. */
  thread: string | null;
  dm: boolean;
  from: string;
  at: string;
  text: string;
  mentionsMe: boolean;
};

export class History {
  constructor(
    private readonly dir: string,
    private readonly limit = 200
  ) {}

  private file(channelId: string) {
    return join(this.dir, `${laneKey(channelId)}.jsonl`);
  }

  async recent(channelId: string, count: number): Promise<Entry[]> {
    return (await readJsonl<Entry>(this.file(channelId))).slice(-count);
  }

  async append(entry: Entry): Promise<void> {
    await Deno.mkdir(this.dir, { recursive: true });
    const file = this.file(entry.channelId);
    await Deno.writeTextFile(file, `${JSON.stringify(entry)}\n`, {
      append: true,
    });

    const all = await readJsonl<Entry>(file);
    if (all.length > this.limit * 2) {
      const kept = all.slice(-this.limit);
      await Deno.writeTextFile(
        file,
        `${kept.map((line) => JSON.stringify(line)).join('\n')}\n`
      );
    }
  }

  /** Channel ids with any recorded history. */
  async channels(): Promise<string[]> {
    const found: string[] = [];
    try {
      for await (const entry of Deno.readDir(this.dir)) {
        if (entry.isFile && entry.name.endsWith('.jsonl'))
          found.push(entry.name.slice(0, -'.jsonl'.length));
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    return found;
  }
}

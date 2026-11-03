import { appendFileSync, existsSync, readFileSync } from 'node:fs';

/** Only acknowledged creations may be reused. Never retry an ambiguous write. */
export class PerformanceJournal {
  readonly completed = new Map<string, string>();
  readonly pending = new Set<string>();
  readonly dataset: string;

  constructor(
    readonly path: string,
    identity: string
  ) {
    if (!existsSync(path)) {
      appendFileSync(
        path,
        `${JSON.stringify({ identity, dataset: Bun.randomUUIDv7() })}\n`,
        { mode: 0o600 }
      );
    }
    const source = readFileSync(path, 'utf8');
    if (!source.endsWith('\n')) throw new Error('Incomplete seed journal');
    const [first, ...lines] = source.trimEnd().split('\n');
    const header: unknown = JSON.parse(first);
    if (
      !header ||
      typeof header !== 'object' ||
      !('identity' in header) ||
      header.identity !== identity ||
      !('dataset' in header) ||
      typeof header.dataset !== 'string'
    )
      throw new Error('Seed journal belongs to another origin or persona');
    this.dataset = header.dataset;
    for (const line of lines) {
      const event: unknown = JSON.parse(line);
      if (
        !event ||
        typeof event !== 'object' ||
        !('key' in event) ||
        typeof event.key !== 'string' ||
        !('kind' in event)
      )
        throw new Error('Invalid seed journal event');
      if (event.kind === 'start') this.pending.add(event.key);
      else if (event.kind === 'not-created') this.pending.delete(event.key);
      else if (
        event.kind === 'done' &&
        'value' in event &&
        typeof event.value === 'string'
      ) {
        this.completed.set(event.key, event.value);
        this.pending.delete(event.key);
      } else throw new Error('Invalid seed journal event');
    }
    if (this.pending.size)
      throw new Error(
        `Unacknowledged writes: ${[...this.pending].join(', ')}. Reconcile through the API before resuming.`
      );
  }

  async create(key: string, work: () => Promise<string>): Promise<string> {
    const existing = this.completed.get(key);
    if (existing !== undefined) return existing;
    if (this.pending.has(key)) throw new Error(`Write already pending: ${key}`);
    appendFileSync(this.path, `${JSON.stringify({ kind: 'start', key })}\n`);
    this.pending.add(key);
    const value = await work();
    if (!value) throw new Error(`Missing result for ${key}`);
    appendFileSync(
      this.path,
      `${JSON.stringify({ kind: 'done', key, value })}\n`
    );
    this.completed.set(key, value);
    this.pending.delete(key);
    return value;
  }
}

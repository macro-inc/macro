import type { IListenerTableMsg } from '@macro-inc/collaboration/session/abi.generated';

const GENERATION = 'ListenerTableGeneration:1:';
const ONLY = 'KeyDownOnly:';
const ALL_LEVELS = 31;
interface Snapshot {
  readonly generation: bigint;
  readonly canonical: string;
  readonly rows: ReadonlyMap<string, number>;
  readonly only: ReadonlyMap<number, readonly string[]>;
}

type ParsedSnapshot = Omit<Snapshot, 'generation'> & {
  readonly generation: bigint | undefined;
};
function snapshot(table: IListenerTableMsg): ParsedSnapshot | undefined {
  const rows = new Map<string, number>();
  const only = new Map<number, readonly string[]>();
  let generation: bigint | undefined;
  let sawGeneration = false;
  for (const row of table.rows) {
    if (rows.has(row.command))
      throw new Error('Duplicate listener metadata row');
    if (
      !Number.isInteger(row.priority) ||
      row.priority < 0 ||
      row.priority > ALL_LEVELS
    )
      throw new Error('Invalid listener metadata priority');
    rows.set(row.command, row.priority);
    if (row.command.startsWith('ListenerTableGeneration:')) {
      if (
        !row.command.startsWith(GENERATION) ||
        row.priority !== 0 ||
        sawGeneration
      )
        return undefined;
      sawGeneration = true;
      const value = row.command.slice(GENERATION.length);
      if (value !== 'unavailable') {
        if (!/^[1-9][0-9]{0,19}$/.test(value)) return undefined;
        const parsed = BigInt(value);
        if (parsed > 0xffffffffffffffffn) return undefined;
        generation = parsed;
      }
    } else if (row.command.startsWith('KeyDownOnly')) {
      if (!row.command.startsWith(ONLY) || row.priority === 0) return undefined;
      const keys: unknown = JSON.parse(row.command.slice(ONLY.length));
      if (
        !Array.isArray(keys) ||
        !keys.every((key): key is string => typeof key === 'string')
      )
        return undefined;
      if (new Set(keys).size !== keys.length) return undefined;
      for (let priority = 0; priority < 5; priority++) {
        if (!(row.priority & (1 << priority))) continue;
        if (only.has(priority)) return undefined;
        only.set(priority, keys);
      }
    } else if (row.command.startsWith('KeyDown') && row.command !== 'KeyDown') {
      return undefined;
    }
  }
  if (!sawGeneration) return undefined;
  const generic = rows.get('KeyDown') ?? 0;
  for (const priority of only.keys())
    if (!(generic & (1 << priority))) return undefined;
  return { generation, canonical: JSON.stringify([...rows]), rows, only };
}

/** One exact module/session/owner/view binding. No cache value authorizes a write. */
export class ListenerMetadataCache {
  private current: Snapshot | undefined;
  private token: bigint | undefined;
  private faultAt: bigint | undefined;
  private closed = false;
  constructor(
    private readonly readToken: () => bigint,
    private readonly bound: () => boolean
  ) {}
  invalidate(): void {
    this.token = undefined;
  }
  close(): void {
    this.closed = true;
    this.token = undefined;
  }

  accept(
    table: IListenerTableMsg,
    _origin: 'cold' | 'output',
    token: bigint
  ): boolean {
    if (this.closed || !this.bound() || token !== this.readToken()) {
      this.invalidate();
      return false;
    }
    let parsed: ParsedSnapshot | undefined;
    try {
      parsed = snapshot(table);
    } catch (error) {
      this.invalidate();
      throw error;
    }
    if (!parsed) {
      this.invalidate();
      return false;
    }
    // Valid v1 transport with exhausted generation cannot authorize Only, but
    // still carries its original-packet fact without inventing a generation.
    if (parsed.generation === undefined) {
      this.invalidate();
      return true;
    }
    const next: Snapshot = { ...parsed, generation: parsed.generation };
    const previous = this.current;
    if (previous && next.generation < previous.generation) return false;
    if (
      previous &&
      next.generation === previous.generation &&
      next.canonical !== previous.canonical
    ) {
      this.faultAt = next.generation;
      this.invalidate();
      throw new Error('Inconsistent listener table at one generation');
    }
    if (this.faultAt !== undefined && next.generation <= this.faultAt) {
      this.invalidate();
      return false;
    }
    // B snapshots the table at actual transfer, so a same-generation output can
    // restore freshness after a no-op root operation without reusing a stale cut.
    if (token !== this.readToken() || !this.bound() || this.closed) {
      this.invalidate();
      return false;
    }
    this.current = next;
    this.token = token;
    return true;
  }

  private fresh(): boolean {
    return (
      !this.closed &&
      this.bound() &&
      this.token !== undefined &&
      this.token === this.readToken() &&
      this.current !== undefined
    );
  }
  needsKeyDown(key: string): boolean {
    if (!this.fresh()) return true;
    return (this.levels('KeyDown', key) ?? 0) !== 0;
  }
  levels(command: string, key?: string): number | undefined {
    const current = this.current;
    if (!current) return undefined;
    // Stale routing uses only last VERIFIED unfiltered facts, never invented
    // membership. It does not claim exact current ordering after a raw bypass.
    const levels = current.rows.get(command) ?? 0;
    if (!this.fresh()) return levels;
    if (command !== 'KeyDown' || key === undefined) return levels;
    let eligible = levels;
    for (const [priority, keys] of current.only) {
      if (!keys.includes(key)) eligible &= ~(1 << priority);
    }
    return eligible;
  }
}

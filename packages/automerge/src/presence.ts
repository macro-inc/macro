import type { Value } from './document';
export type EphemeralStoreEvent = {
  by: 'local' | 'remote';
  added: string[];
  updated: string[];
  removed: string[];
};
export class EphemeralStore<
  T extends Record<string, Value> = Record<string, Value>,
> {
  private entries = new Map<
    string,
    { clock: number; value: Value; received: number }
  >();
  private listeners = new Set<(event: EphemeralStoreEvent) => void>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly timeout = 10000) {}
  private scheduleExpiry() {
    if (this.timer) clearTimeout(this.timer);
    const active = [...this.entries.values()].filter(
      (entry) => entry.value != null
    );
    if (!this.listeners.size || !active.length) return;
    const next = Math.min(
      ...active.map((entry) => entry.received + this.timeout)
    );
    this.timer = setTimeout(
      () => {
        const removed: string[] = [];
        for (const [key, entry] of this.entries)
          if (
            entry.value != null &&
            Date.now() - entry.received >= this.timeout
          ) {
            entry.value = null;
            removed.push(key);
          }
        if (removed.length)
          for (const listener of this.listeners)
            listener({ by: 'remote', added: [], updated: [], removed });
        this.scheduleExpiry();
      },
      Math.max(1, next - Date.now())
    );
  }
  delete(key: string) {
    this.set(key, undefined as T[string]);
  }
  private emit(by: EphemeralStoreEvent['by'], peers: string[]) {
    for (const listener of this.listeners)
      listener({ by, added: [], updated: peers, removed: [] });
  }
  set(key: string, value: T[string]) {
    this.entries.set(key, {
      clock: (this.entries.get(key)?.clock ?? 0) + 1,
      value: value ?? null,
      received: Date.now(),
    });
    this.emit('local', [key]);
    this.scheduleExpiry();
  }
  get(key: string): T[string] | undefined {
    const entry = this.entries.get(key);
    return entry && Date.now() - entry.received < this.timeout
      ? (entry.value as T[string])
      : undefined;
  }
  getAllStates(): T {
    return Object.fromEntries(
      [...this.entries.keys()]
        .map((key) => [key, this.get(key)])
        .filter(([, value]) => value != null)
    ) as T;
  }
  encode(key: string) {
    const entry = this.entries.get(key);
    return new TextEncoder().encode(
      JSON.stringify(
        entry ? { [key]: { clock: entry.clock, value: entry.value } } : {}
      )
    );
  }
  encodeAll() {
    return new TextEncoder().encode(
      JSON.stringify(
        Object.fromEntries(
          [...this.entries].map(([key, entry]) => [
            key,
            { clock: entry.clock, value: entry.value },
          ])
        )
      )
    );
  }
  apply(bytes: Uint8Array) {
    if (!bytes.length) return;
    const updates = JSON.parse(new TextDecoder().decode(bytes));
    const changed: string[] = [];
    for (const [key, incoming] of Object.entries(updates)) {
      const update = incoming as { clock: number; value: Value };
      const current = this.entries.get(key);
      if (
        !current ||
        update.clock > current.clock ||
        (update.clock === current.clock && update.value === null)
      ) {
        this.entries.set(key, { ...update, received: Date.now() });
        changed.push(key);
      }
    }
    this.emit('remote', changed);
    this.scheduleExpiry();
  }
  subscribe(listener: (event: EphemeralStoreEvent) => void) {
    this.listeners.add(listener);
    this.scheduleExpiry();
    return () => {
      this.listeners.delete(listener);
      this.scheduleExpiry();
    };
  }
  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.entries.clear();
    this.listeners.clear();
  }
}

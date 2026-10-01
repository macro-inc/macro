/** JSON presence codec, deliberately independent of Automerge document bytes. */
export class PresenceStore {
  private entries: Record<string, { clock: number; value: unknown; received: number }> = {};
  constructor(private readonly timeout: number) {}
  set(peer: string, value: unknown) {
    this.entries[peer] = { clock: (this.entries[peer]?.clock ?? 0) + 1, value, received: Date.now() };
  }
  apply(bytes: Uint8Array) {
    const updates: Record<string, { clock: number; value: unknown }> = JSON.parse(new TextDecoder().decode(bytes));
    for (const [peer, update] of Object.entries(updates)) {
      const current = this.entries[peer];
      if (!current || update.clock > current.clock || (update.clock === current.clock && update.value === null)) {
        this.entries[peer] = { ...update, received: Date.now() };
      }
    }
  }
  encode(peer: string) {
    const entry = this.entries[peer];
    return new TextEncoder().encode(JSON.stringify(entry ? { [peer]: { clock: entry.clock, value: entry.value ?? null } } : {}));
  }
  encodeAll() {
    return new TextEncoder().encode(JSON.stringify(Object.fromEntries(Object.entries(this.entries).map(([peer, entry]) => [peer, { clock: entry.clock, value: entry.value }]))));
  }
  getAllStates(): Record<string, unknown> {
    return Object.fromEntries(Object.entries(this.entries).filter(([, entry]) => entry.value != null && Date.now() - entry.received < this.timeout).map(([peer, entry]) => [peer, entry.value]));
  }
}

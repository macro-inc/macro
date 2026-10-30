/** Pure values only: Workers must never retain another request's sockets/promises. */
export class CanvasCache<T> {
  private readonly entries = new Map<
    string,
    { value: T; bytes: number; expires: number }
  >();
  private bytes = 0;
  constructor(
    private readonly limit: number,
    private readonly maxBytes: number,
    private readonly ttl: number
  ) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    if (entry.expires <= Date.now()) return;
    this.entries.set(key, entry);
    this.bytes += entry.bytes;
    return structuredClone(entry.value);
  }
  set(key: string, value: T) {
    // UTF-16 strings are accounted conservatively, including the exact key.
    const bytes = 2 * (key.length + JSON.stringify(value).length);
    if (bytes > this.maxBytes) return;
    const old = this.entries.get(key);
    if (old) this.bytes -= old.bytes;
    this.entries.delete(key);
    for (const [id, entry] of this.entries) {
      if (entry.expires <= Date.now()) {
        this.entries.delete(id);
        this.bytes -= entry.bytes;
      }
    }
    while (
      this.entries.size >= this.limit ||
      this.bytes + bytes > this.maxBytes
    ) {
      const first = this.entries.entries().next().value;
      if (!first) break;
      this.entries.delete(first[0]);
      this.bytes -= first[1].bytes;
    }
    this.entries.set(key, {
      value: structuredClone(value),
      bytes,
      expires: Date.now() + this.ttl,
    });
    this.bytes += bytes;
  }
}

/** A small in-memory cache that can never return data across viewer changes. */
export class ViewerBoundPreloadCache<Value> {
  readonly #maxEntries: number;
  readonly #entries = new Map<string, Value>();
  #viewerId: string | undefined;

  constructor(maxEntries: number) {
    this.#maxEntries = maxEntries;
  }

  set(viewerId: string, key: string, value: Value | undefined): void {
    this.#bindViewer(viewerId);
    this.#entries.delete(key);
    if (value === undefined) return;
    this.#entries.set(key, value);

    while (this.#entries.size > this.#maxEntries) {
      const oldestKey = this.#entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.#entries.delete(oldestKey);
    }
  }

  get(viewerId: string, key: string): Value | undefined {
    if (this.#viewerId !== viewerId) return undefined;
    return this.#entries.get(key);
  }

  clear(): void {
    this.#entries.clear();
    this.#viewerId = undefined;
  }

  #bindViewer(viewerId: string): void {
    if (this.#viewerId === viewerId) return;
    this.#entries.clear();
    this.#viewerId = viewerId;
  }
}

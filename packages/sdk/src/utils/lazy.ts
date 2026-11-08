/**
 * A value fetched on first access and cached thereafter. Powers thin entity
 * handles: construction is free, the record is loaded lazily the first time a
 * field is read, and concurrent reads share one in-flight request. Pass a
 * `seed` when the record is already known (from a list or an event) to skip the
 * fetch entirely.
 */
export class Lazy<T> {
  private value?: T;
  private inflight?: Promise<T>;
  private generation = 0;

  constructor(
    private readonly loader: () => Promise<T>,
    seed?: T,
  ) {
    this.value = seed;
  }

  get(): Promise<T> {
    if (this.value !== undefined) return Promise.resolve(this.value);
    const generation = this.generation;
    this.inflight ??= this.loader().then((v) => {
      if (generation === this.generation) this.value = v;
      return v;
    });
    return this.inflight;
  }

  /** The cached value, if already loaded — never triggers a fetch. */
  peek(): T | undefined {
    return this.value;
  }

  /** Drop cached detail and fence older loads so the next read refetches. */
  clear(): void {
    this.generation++;
    this.value = undefined;
    this.inflight = undefined;
  }
}

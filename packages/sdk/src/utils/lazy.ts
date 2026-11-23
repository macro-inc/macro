/**
 * A value fetched on first access and cached thereafter. Powers thin entity
 * handles: construction is free, the record is loaded lazily the first time a
 * field is read, and concurrent reads share one in-flight request. Pass a
 * `seed` when the record is already known (from a list or an event) to skip the
 * fetch entirely.
 */
export class Lazy<T> {
  private value?: T;
  private listed: Partial<T> = {};
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

  /**
   * Keep fields a listing already returned, so reading one needs no fetch.
   * `null` and `undefined` values are skipped: a field the listing did not
   * carry still loads. A full load, {@link set} or {@link clear} supersedes
   * them.
   */
  know(fields: Partial<T>): void {
    for (const [key, value] of Object.entries(fields) as [
      keyof T,
      T[keyof T],
    ][])
      if (value !== null && value !== undefined) this.listed[key] = value;
  }

  /**
   * One field from a listing, while the full value has not loaded; `undefined`
   * means read it through {@link get}.
   */
  listedField<K extends keyof T>(key: K): T[K] | undefined {
    return this.value === undefined ? this.listed[key] : undefined;
  }

  /** The cached value, if already loaded — never triggers a fetch. */
  peek(): T | undefined {
    return this.value;
  }

  /**
   * Replace the cached value with one known to be current, such as a write's
   * response, and fence older loads so they cannot overwrite it.
   */
  set(value: T): void {
    this.generation++;
    this.value = value;
    this.listed = {};
    this.inflight = undefined;
  }

  /** Drop cached detail and fence older loads so the next read refetches. */
  clear(): void {
    this.generation++;
    this.value = undefined;
    this.listed = {};
    this.inflight = undefined;
  }
}

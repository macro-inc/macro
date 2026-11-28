/**
 * An in-memory Origin Private File System and Web Locks for running the real
 * cache engine (cache-wasm over turso-opfs) outside a browser.
 *
 * Only what turso-opfs and the engine worker call is implemented, with the
 * browser's refusals: one sync access handle per file, no removal while a
 * handle is open, and `DOMException`s named as Chromium names them.
 */

/** One file's bytes and its open access handle, if any. */
export type MemoryFile = {
  bytes: Uint8Array;
  size: number;
  handle: MemorySyncAccessHandle | undefined;
};

type ReadWriteOptions = { at?: number };

function domError(name: string, message: string): DOMException {
  return new DOMException(message, name);
}

/** The counts a harness reads off the file system. */
export type MemoryOpfsCounters = {
  reads: number;
  writes: number;
  bytesRead: number;
  bytesWritten: number;
  flushes: number;
};

export class MemorySyncAccessHandle {
  #file: MemoryFile | undefined;
  readonly #counters: MemoryOpfsCounters;

  constructor(file: MemoryFile, counters: MemoryOpfsCounters) {
    this.#file = file;
    this.#counters = counters;
  }

  #open(): MemoryFile {
    if (!this.#file)
      throw domError('InvalidStateError', 'The access handle was closed.');
    return this.#file;
  }

  read(buffer: Uint8Array, options: ReadWriteOptions = {}): number {
    const file = this.#open();
    const at = options.at ?? 0;
    if (at >= file.size) return 0;
    const count = Math.min(buffer.byteLength, file.size - at);
    buffer.set(file.bytes.subarray(at, at + count));
    this.#counters.reads += 1;
    this.#counters.bytesRead += count;
    return count;
  }

  write(buffer: Uint8Array, options: ReadWriteOptions = {}): number {
    const file = this.#open();
    const at = options.at ?? 0;
    const end = at + buffer.byteLength;
    reserve(file, end);
    file.bytes.set(buffer, at);
    file.size = Math.max(file.size, end);
    this.#counters.writes += 1;
    this.#counters.bytesWritten += buffer.byteLength;
    return buffer.byteLength;
  }

  truncate(size: number): void {
    const file = this.#open();
    if (size > file.size) {
      reserve(file, size);
      file.bytes.fill(0, file.size, size);
    }
    file.size = size;
  }

  getSize(): number {
    return this.#open().size;
  }

  flush(): void {
    this.#open();
    this.#counters.flushes += 1;
  }

  close(): void {
    const file = this.#file;
    if (!file) return;
    if (file.handle === this) file.handle = undefined;
    this.#file = undefined;
  }
}

function reserve(file: MemoryFile, size: number): void {
  if (size <= file.bytes.byteLength) return;
  let capacity = Math.max(file.bytes.byteLength, 64 * 1024);
  while (capacity < size) capacity *= 2;
  const grown = new Uint8Array(capacity);
  grown.set(file.bytes.subarray(0, file.size));
  file.bytes = grown;
}

export class MemoryFileHandle {
  readonly kind = 'file';
  readonly name: string;
  readonly #file: MemoryFile;
  readonly #counters: MemoryOpfsCounters;

  constructor(name: string, file: MemoryFile, counters: MemoryOpfsCounters) {
    this.name = name;
    this.#file = file;
    this.#counters = counters;
  }

  async createSyncAccessHandle(): Promise<MemorySyncAccessHandle> {
    if (this.#file.handle)
      throw domError(
        'NoModificationAllowedError',
        'Access handles cannot be created while another is open.'
      );
    const handle = new MemorySyncAccessHandle(this.#file, this.#counters);
    this.#file.handle = handle;
    return handle;
  }
}

export class MemoryDirectoryHandle {
  readonly kind = 'directory';
  readonly name: string;
  readonly #files = new Map<string, MemoryFile>();
  readonly #counters: MemoryOpfsCounters;

  constructor(
    name: string,
    counters: MemoryOpfsCounters,
    files: Iterable<[string, MemoryFile]> = []
  ) {
    this.name = name;
    this.#counters = counters;
    for (const [fileName, file] of files) this.#files.set(fileName, file);
  }

  async getFileHandle(
    name: string,
    options: { create?: boolean } = {}
  ): Promise<MemoryFileHandle> {
    let file = this.#files.get(name);
    if (!file) {
      if (!options.create)
        throw domError('NotFoundError', `A file named ${name} was not found.`);
      file = { bytes: new Uint8Array(0), size: 0, handle: undefined };
      this.#files.set(name, file);
    }
    return new MemoryFileHandle(name, file, this.#counters);
  }

  async getDirectoryHandle(name: string): Promise<never> {
    throw domError('NotFoundError', `A directory named ${name} was not found.`);
  }

  async removeEntry(name: string): Promise<void> {
    const file = this.#files.get(name);
    if (!file)
      throw domError('NotFoundError', `A file named ${name} was not found.`);
    if (file.handle)
      throw domError(
        'NoModificationAllowedError',
        `${name} has an open access handle.`
      );
    this.#files.delete(name);
  }

  async *keys(): AsyncGenerator<string> {
    yield* [...this.#files.keys()];
  }

  async *entries(): AsyncGenerator<[string, MemoryFileHandle]> {
    for (const [name, file] of [...this.#files])
      yield [name, new MemoryFileHandle(name, file, this.#counters)];
  }

  async *values(): AsyncGenerator<MemoryFileHandle> {
    for await (const [, handle] of this.entries()) yield handle;
  }

  [Symbol.asyncIterator](): AsyncGenerator<[string, MemoryFileHandle]> {
    return this.entries();
  }

  /**
   * The files, for a later page's root: every handle the last page held is
   * closed, as the browser closes them when the worker holding them ends. A
   * plain value, because the later page may load this module anew.
   */
  releaseFiles(): Array<[string, MemoryFile]> {
    for (const file of this.#files.values()) file.handle?.close();
    return [...this.#files];
  }

  /** Bytes held by each file, for reports. */
  fileSizes(): Record<string, number> {
    return Object.fromEntries(
      [...this.#files].map(([name, file]) => [name, file.size])
    );
  }
}

type HeldLock = {
  name: string;
  mode: LockMode;
  released: Promise<void>;
  release: () => void;
};

type LockWaiter = {
  name: string;
  mode: LockMode;
  grant: () => void;
};

/**
 * Web Locks for one origin: exclusive and shared modes, `ifAvailable`,
 * `signal`, and `query`. Grants are FIFO per name, as the spec requires.
 */
export class MemoryLockManager {
  readonly #held: HeldLock[] = [];
  readonly #waiting: LockWaiter[] = [];

  #grantable(name: string, mode: LockMode): boolean {
    const holders = this.#held.filter((lock) => lock.name === name);
    if (holders.length === 0) return true;
    return mode === 'shared' && holders.every((lock) => lock.mode === 'shared');
  }

  #pump(): void {
    for (const waiter of [...this.#waiting]) {
      const ahead = this.#waiting.filter((other) => other.name === waiter.name);
      if (ahead[0] !== waiter) continue;
      if (!this.#grantable(waiter.name, waiter.mode)) continue;
      this.#waiting.splice(this.#waiting.indexOf(waiter), 1);
      waiter.grant();
    }
  }

  async request<T>(
    name: string,
    optionsOrCallback: LockOptions | ((lock: Lock | null) => T),
    maybeCallback?: (lock: Lock | null) => T
  ): Promise<Awaited<T>> {
    const options =
      typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
    const callback = (
      typeof optionsOrCallback === 'function'
        ? optionsOrCallback
        : maybeCallback
    ) as (lock: Lock | null) => T;
    const mode: LockMode = options.mode ?? 'exclusive';
    const queued = this.#waiting.some((waiter) => waiter.name === name);
    if (options.ifAvailable && (queued || !this.#grantable(name, mode)))
      return await callback(null);
    options.signal?.throwIfAborted();
    if (queued || !this.#grantable(name, mode)) {
      await new Promise<void>((resolve, reject) => {
        const waiter: LockWaiter = { name, mode, grant: resolve };
        this.#waiting.push(waiter);
        options.signal?.addEventListener(
          'abort',
          () => {
            const index = this.#waiting.indexOf(waiter);
            if (index < 0) return;
            this.#waiting.splice(index, 1);
            reject(options.signal?.reason);
            this.#pump();
          },
          { once: true }
        );
      });
    }
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held: HeldLock = { name, mode, released, release };
    this.#held.push(held);
    try {
      return await callback({ name, mode } as Lock);
    } finally {
      this.#held.splice(this.#held.indexOf(held), 1);
      held.release();
      this.#pump();
    }
  }

  async query(): Promise<LockManagerSnapshot> {
    return {
      held: this.#held.map(({ name, mode }) => ({
        name,
        mode,
        clientId: 'headless',
      })),
      pending: this.#waiting.map(({ name, mode }) => ({
        name,
        mode,
        clientId: 'headless',
      })),
    };
  }
}

/** Matches only the global object, as the engine's worker-scope checks need. */
function globalScopeClass(): { [Symbol.hasInstance](value: unknown): boolean } {
  return {
    [Symbol.hasInstance]: (value: unknown) => value === globalThis,
  };
}

export type MemoryOpfs = {
  root: MemoryDirectoryHandle;
  locks: MemoryLockManager;
  counters: MemoryOpfsCounters;
  /** Globals to stub: the worker-scope and file-system classes the engine
   * checks with `instanceof`, and a navigator with storage and locks. */
  globals: Record<string, unknown>;
};

function emptyCounters(): MemoryOpfsCounters {
  return { reads: 0, writes: 0, bytesRead: 0, bytesWritten: 0, flushes: 0 };
}

function assembleOpfs(
  root: MemoryDirectoryHandle,
  counters: MemoryOpfsCounters,
  baseNavigator: Partial<Navigator>
): MemoryOpfs {
  const locks = new MemoryLockManager();
  return {
    root,
    locks,
    counters,
    globals: {
      WorkerGlobalScope: globalScopeClass(),
      DedicatedWorkerGlobalScope: globalScopeClass(),
      FileSystemDirectoryHandle: MemoryDirectoryHandle,
      FileSystemFileHandle: MemoryFileHandle,
      FileSystemSyncAccessHandle: MemorySyncAccessHandle,
      navigator: {
        onLine: true,
        userAgent: 'headless-cache-harness',
        language: 'en-US',
        languages: ['en-US'],
        ...baseNavigator,
        locks,
        storage: {
          getDirectory: async () => root,
          estimate: async () => ({ usage: 0, quota: 1 << 30 }),
          persisted: async () => true,
        },
      },
    },
  };
}

/** A fresh, empty origin. */
export function createMemoryOpfs(
  baseNavigator: Partial<Navigator> = {}
): MemoryOpfs {
  const counters = emptyCounters();
  return assembleOpfs(
    new MemoryDirectoryHandle('', counters),
    counters,
    baseNavigator
  );
}

/**
 * The origin of `previous` as the next page load finds it: the same files,
 * with the last page's handles closed, no locks held and counters at zero.
 */
export function reopenMemoryOpfs(
  previous: MemoryOpfs,
  baseNavigator: Partial<Navigator> = {}
): MemoryOpfs {
  const counters = emptyCounters();
  const root = new MemoryDirectoryHandle(
    '',
    counters,
    previous.root.releaseFiles()
  );
  return assembleOpfs(root, counters, baseNavigator);
}

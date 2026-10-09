import type {
  EmailPreparation,
  EmailPreparationRequest,
  PreparedEmailLease,
} from '@app/features/email-message/context/email-preparation';
import {
  type EmailBodyInput,
  PREPARE_VERSION,
  type PreparedEmailBody,
} from '@macro-inc/email-renderer';
import { directExecutor, type PreparationExecutor } from './executor';
import { policyTuple, sameSource, sourceBytes } from './keys';
import { PreparedMemory } from './memory';
import { cancelled, isCancelled, PreparationScheduler } from './scheduler';
import {
  ARTIFACT_SCHEMA_VERSION,
  type Artifact,
  type ArtifactStore,
  artifactBytes,
  attempt,
  storageDeadline,
  validArtifact,
} from './store';

function variantBytes(policy: string): number {
  return policy.length * 2 + 512;
}

interface Consumer {
  priority: number;
}

interface Variant {
  key?: string;
  pending?: Promise<PreparedEmailBody>;
  /** Live leases. The variant runs at its most urgent consumer's priority. */
  consumers: Set<Consumer>;
}

/** Infinity without live consumers. */
function variantPriority(variant: Variant): number {
  let priority = Infinity;
  for (const consumer of variant.consumers)
    priority = Math.min(priority, consumer.priority);
  return priority;
}

function hasReader(binding: Binding): boolean {
  for (const variant of binding.variants.values())
    for (const consumer of variant.consumers)
      if (consumer.priority === 0) return true;
  return false;
}

/** Handles a promise whose failure belongs to its consumer. */
async function settle(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    /* The owning consumer handles failures. */
  }
}

function cancelledLease(): PreparedEmailLease {
  const promise = Promise.reject(cancelled());
  void settle(promise);
  return { ready: undefined, promise, promote() {}, release() {} };
}

interface Binding {
  input: EmailBodyInput;
  sourceHash?: Promise<string>;
  variants: Map<string, Variant>;
  bytes: number;
  current: boolean;
}

export interface RenderCacheOptions {
  memoryBytes?: number;
  executor?: PreparationExecutor;
  store?: () => Promise<ArtifactStore | undefined>;
  /** Storage was invalidated by another session without this one hearing it. */
  onStaleGeneration?: () => void;
  /** Consulted before every write; false skips persisting the artifact. */
  mayPersist?: () => boolean;
}

/** Session-owned, value-selected preparation. No authorization or transport. */
export class EmailRenderCache implements EmailPreparation {
  readonly memory: PreparedMemory;
  private bindings = new Map<string, Binding>();
  private bindingBytes = 0;
  private artifacts = new Map<string, Promise<PreparedEmailBody>>();
  private scheduler = new PreparationScheduler();
  private executor: PreparationExecutor;
  private disposed = false;
  private storage?: Promise<
    { store: ArtifactStore; generation: number } | undefined
  >;
  private writes = new Set<ReturnType<typeof setTimeout>>();

  constructor(private options: RenderCacheOptions = {}) {
    this.memory = new PreparedMemory(options.memoryBytes ?? 16 * 1024 * 1024);
    this.executor = options.executor ?? directExecutor;
  }

  get estimatedBytes(): number {
    return this.memory.bytes + this.bindingBytes;
  }

  /** Open the disposable tier ahead of a body request without starting parsing. */
  initializeStorage(): void {
    void this.getStorage();
  }

  acquire(request: EmailPreparationRequest): PreparedEmailLease {
    if (this.disposed) throw cancelled();
    const id = JSON.stringify([request.mailboxId, request.messageId]);
    const priority = request.priority ?? 0;
    let binding = this.bindings.get(id);
    const changed = !binding || !sameSource(binding.input, request.input);
    // Speculation never replaces the source of a body someone is reading.
    if (binding && changed && priority > 0 && hasReader(binding))
      return cancelledLease();
    if (!binding || changed) {
      if (binding) {
        binding.current = false;
        this.bindingBytes -= binding.bytes;
      }
      binding = {
        input: { ...request.input },
        bytes: sourceBytes(request.input) + 256,
        variants: new Map(),
        current: true,
      };
      this.bindings.set(id, binding);
      this.bindingBytes += binding.bytes;
    }
    this.bindings.delete(id);
    this.bindings.set(id, binding);
    const policy = policyTuple(request.options);
    let variant = binding.variants.get(policy);
    if (!variant) {
      variant = { consumers: new Set() };
      binding.variants.set(policy, variant);
      const bytes = variantBytes(policy);
      binding.bytes += bytes;
      this.bindingBytes += bytes;
    }
    binding.variants.delete(policy);
    binding.variants.set(policy, variant);
    const consumer: Consumer = { priority };
    variant.consumers.add(consumer);
    const selected = variant;
    const source = binding;
    const ready = variant.key ? this.memory.get(variant.key) : undefined;
    let releaseMemory = ready ? this.memory.retain(variant.key!) : undefined;
    let released = false;
    const live = () => !released && !this.disposed && source.current;
    const start = () => {
      if (!selected.pending) {
        selected.pending = this.resolve(request, id, source, selected, policy);
        void this.finishVariant(source, selected, selected.pending);
      }
      return selected.pending;
    };
    const receive = async () => {
      let pending = ready ? Promise.resolve(ready) : start();
      for (let restarted = false; ; restarted = true) {
        try {
          const body = await pending;
          if (!live()) throw cancelled();
          // Another lease can trigger trimming between publication and
          // delivery. Republish before pinning so every active value stays
          // byte-accounted.
          const retained = this.memory.publish(selected.key!, body);
          releaseMemory ??= this.memory.retain(selected.key!);
          this.trim();
          return retained;
        } catch (error) {
          // A lease that left reports cancellation, not a shared job's error.
          if (!live()) throw cancelled();
          // A shared job can be cancelled for consumers that left, or for a
          // lower priority, just before this one joined. Restart it once.
          if (restarted || !isCancelled(error)) throw error;
          if (selected.pending === pending) selected.pending = undefined;
          pending = start();
        }
      }
    };
    const promise = receive();
    // A synchronous hit consumer need not subscribe to the completion promise.
    void settle(promise);
    this.trim();
    return {
      ready,
      promise,
      promote: () => {
        if (!released) consumer.priority = 0;
      },
      release: () => {
        if (released) return;
        released = true;
        selected.consumers.delete(consumer);
        releaseMemory?.();
        this.trim();
      },
    };
  }

  private async finishVariant(
    binding: Binding,
    variant: Variant,
    promise: Promise<PreparedEmailBody>
  ): Promise<void> {
    try {
      await promise;
    } catch {
      /* A rejected speculative job must remain retryable in the foreground. */
    } finally {
      if (variant.pending === promise) variant.pending = undefined;
      if (!variant.key) binding.sourceHash = undefined;
      this.trim();
    }
  }

  private async getStorage() {
    if (!this.options.store) return;
    // Opening can wait on another tab's clear. Bound it generously, and leave
    // the 150ms deadline to foreground reads: a slow open must not disable
    // persistence for the rest of this session.
    this.storage ??= storageDeadline(this.openStorage(), 10_000);
    return this.storage;
  }

  private async openStorage() {
    try {
      const store = await this.options.store!();
      if (!store) return;
      return { store, generation: await store.generation() };
    } catch {
      // An injected adapter may throw before returning a promise.
      return undefined;
    }
  }

  private async resolve(
    request: EmailPreparationRequest,
    id: string,
    binding: Binding,
    variant: Variant,
    policy: string
  ): Promise<PreparedEmailBody> {
    const valid = () =>
      !this.disposed && binding.current && variant.consumers.size > 0;
    if (variantPriority(variant) > 0 && binding.bytes > 256 * 1024)
      throw cancelled();
    // Bound hashing too: a dedicated worker's message queue must not become an
    // unbounded, unprioritized queue ahead of a foreground request.
    const [sourceHash, policyHash, mailboxHash] = await this.scheduler.schedule(
      () => variantPriority(variant),
      valid,
      async () => {
        // Shared by all variants of this message input generation.
        if (!binding.sourceHash) {
          const hashing = this.executor.hashSource(
            binding.input,
            variantPriority(variant)
          );
          binding.sourceHash = hashing;
          void (async () => {
            try {
              await hashing;
            } catch {
              // A failed hash must not be reused by every later retry.
              if (binding.sourceHash === hashing)
                binding.sourceHash = undefined;
            }
          })();
        }
        return await Promise.all([
          binding.sourceHash,
          this.executor.hash(policy),
          // Framed like every other hash input, so ids never alias.
          this.executor.hash(JSON.stringify([request.mailboxId])),
        ]);
      }
    );
    if (!valid()) throw cancelled();
    const key = JSON.stringify([
      mailboxHash,
      PREPARE_VERSION,
      sourceHash,
      policyHash,
    ]);
    variant.key = key;
    let body = this.memory.get(key);
    if (!body) {
      let job = this.artifacts.get(key);
      if (!job) {
        // Artifact work is shared across messages. A disappearing initiator
        // cannot cancel another message's lease for identical content.
        const artifactValid = () =>
          !this.disposed && this.priorityFor(key) < Infinity;
        const artifactPriority = () => this.priorityFor(key);
        job = this.load(
          key,
          sourceHash,
          policyHash,
          binding.input,
          request,
          artifactPriority,
          artifactValid
        );
        this.artifacts.set(key, job);
        void this.finishArtifact(key, job);
      }
      body = await job;
    }
    if (!valid()) throw cancelled();
    // Association is refreshed even on a content-deduplicated memory hit.
    this.save(
      key,
      body,
      sourceHash,
      policyHash,
      request,
      id,
      () => !this.disposed && binding.current
    );
    return body;
  }

  /** Infinity when no current consumer holds this artifact. */
  private priorityFor(key: string): number {
    let priority = Infinity;
    for (const binding of this.bindings.values())
      for (const variant of binding.variants.values()) {
        if (binding.current && variant.key === key)
          priority = Math.min(priority, variantPriority(variant));
      }
    return priority;
  }

  private async finishArtifact(
    key: string,
    job: Promise<PreparedEmailBody>
  ): Promise<void> {
    try {
      await job;
    } catch {
      /* Consumers own errors; a failure remains retryable. */
    } finally {
      if (this.artifacts.get(key) === job) this.artifacts.delete(key);
    }
  }

  private async load(
    key: string,
    sourceHash: string,
    policyHash: string,
    input: EmailBodyInput,
    request: EmailPreparationRequest,
    priority: () => number,
    valid: () => boolean
  ): Promise<PreparedEmailBody> {
    const storage = await storageDeadline(this.getStorage());
    if (storage && valid()) {
      // An adapter that throws synchronously is a cache failure, not a mail one.
      const cached = await storageDeadline(
        attempt(() => storage.store.read(key))
      );
      if (!valid()) throw cancelled();
      if (validArtifact(cached, key, sourceHash, policyHash)) {
        return this.memory.publish(key, cached.body);
      }
      if (cached !== undefined)
        void storageDeadline(attempt(() => storage.store.remove(key)));
    }
    return await this.scheduler.schedule(priority, valid, async () => {
      const body = await this.executor.prepare(
        input,
        request.options,
        priority()
      );
      if (!valid()) throw cancelled();
      return this.memory.publish(key, body);
    });
  }

  private save(
    key: string,
    body: PreparedEmailBody,
    sourceHash: string,
    policyHash: string,
    request: EmailPreparationRequest,
    id: string,
    valid: () => boolean
  ): void {
    if (!this.options.store) return;
    const timer = setTimeout(() => {
      this.writes.delete(timer);
      void persist();
    }, 0);
    this.writes.add(timer);
    const artifact: Artifact = {
      key,
      body,
      sourceHash,
      policyHash,
      schema: ARTIFACT_SCHEMA_VERSION,
      version: PREPARE_VERSION,
      bytes: artifactBytes(body),
      lastUsed: Date.now(),
    };
    const persist = async () => {
      const storage = await this.getStorage();
      if (!storage || !valid() || this.options.mayPersist?.() === false) return;
      const association = {
        id,
        threadId: request.threadId,
        mailboxId: request.mailboxId,
        sourceHash,
        keys: [key],
      };
      const written = (current: boolean) => {
        if (current === false && !this.disposed)
          this.options.onStaleGeneration?.();
      };
      try {
        written(
          await storage.store.write(storage.generation, artifact, association)
        );
      } catch (error) {
        // Quota, denial, and corruption are cache failures, never mail failures.
        if (
          error instanceof DOMException &&
          error.name === 'QuotaExceededError' &&
          storage.store.evict
        ) {
          try {
            await storage.store.evict();
            if (valid())
              written(
                await storage.store.write(
                  storage.generation,
                  artifact,
                  association
                )
              );
          } catch {
            this.options.store = undefined;
          }
        } else this.options.store = undefined;
      }
    };
  }

  private trim(): void {
    for (const [id, binding] of this.bindings) {
      for (const [policy, variant] of binding.variants) {
        if (binding.variants.size <= 8) break;
        if (variant.consumers.size || variant.pending) continue;
        binding.variants.delete(policy);
        const bytes = variantBytes(policy);
        binding.bytes -= bytes;
        this.bindingBytes -= bytes;
      }
      if (
        this.bindingBytes < this.memory.budget / 2 &&
        this.bindings.size <= 256
      )
        continue;
      if (
        [...binding.variants.values()].some(
          (variant) => variant.consumers.size || variant.pending
        )
      )
        continue;
      this.bindings.delete(id);
      binding.current = false;
      this.bindingBytes -= binding.bytes;
    }
    this.memory.trim(this.bindingBytes);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.writes) clearTimeout(timer);
    this.writes.clear();
    this.scheduler.dispose();
    this.executor.dispose();
    for (const binding of this.bindings.values()) binding.current = false;
    this.bindings.clear();
    this.artifacts.clear();
    this.bindingBytes = 0;
    this.memory.clear();
  }
}

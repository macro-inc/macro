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
import { cancelled, PreparationScheduler } from './scheduler';
import {
  ARTIFACT_SCHEMA_VERSION,
  type Artifact,
  type ArtifactStore,
  storageDeadline,
  validArtifact,
} from './store';

interface Variant {
  key?: string;
  pending?: Promise<PreparedEmailBody>;
  consumers: number;
  priority: number;
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
    let binding = this.bindings.get(id);
    if (!binding || !sameSource(binding.input, request.input)) {
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
      variant = { consumers: 0, priority: request.priority ?? 0 };
      binding.variants.set(policy, variant);
      const bytes = policy.length * 2 + 512;
      binding.bytes += bytes;
      this.bindingBytes += bytes;
    }
    binding.variants.delete(policy);
    binding.variants.set(policy, variant);
    variant.priority = Math.min(variant.priority, request.priority ?? 0);
    variant.consumers++;
    const selected = variant;
    const source = binding;
    const ready = variant.key ? this.memory.get(variant.key) : undefined;
    let releaseMemory = ready ? this.memory.retain(variant.key!) : undefined;
    let released = false;
    if (!ready && !variant.pending) {
      variant.pending = this.resolve(request, id, source, selected, policy);
      void this.finishVariant(source, variant, variant.pending);
    }
    const pending = ready ? Promise.resolve(ready) : variant.pending!;
    const receive = async () => {
      const body = await pending;
      if (released || this.disposed || !source.current) throw cancelled();
      // Another lease can trigger trimming between publication and delivery.
      // Republish before pinning so every active value stays byte-accounted.
      const retained =
        this.memory.get(selected.key!) ??
        this.memory.publish(selected.key!, body);
      releaseMemory ??= this.memory.retain(selected.key!);
      this.trim();
      return retained;
    };
    const promise = receive();
    // A synchronous hit consumer need not subscribe to the completion promise.
    void this.ignoreCancellation(promise);
    this.trim();
    return {
      ready,
      promise,
      promote: () => {
        selected.priority = 0;
      },
      release: () => {
        if (released) return;
        released = true;
        selected.consumers--;
        releaseMemory?.();
        this.trim();
      },
    };
  }

  private async ignoreCancellation(promise: Promise<unknown>): Promise<void> {
    try {
      await promise;
    } catch {
      /* The owning consumer handles failures. */
    }
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
      if (!variant.consumers) this.trim();
    }
  }

  private async getStorage() {
    if (!this.options.store) return;
    this.storage ??= this.openStorage();
    return this.storage;
  }

  private async openStorage() {
    try {
      const store = await storageDeadline(this.options.store!());
      if (!store) return;
      const generation = await storageDeadline(store.generation());
      return generation === undefined ? undefined : { store, generation };
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
      !this.disposed && binding.current && variant.consumers > 0;
    if (variant.priority > 0 && binding.bytes > 256 * 1024) throw cancelled();
    // Bound hashing too: a dedicated worker's message queue must not become an
    // unbounded, unprioritized queue ahead of a foreground request.
    const [sourceHash, policyHash, mailboxHash] = await this.scheduler.schedule(
      () => variant.priority,
      valid,
      async () => {
        // Shared by all variants of this message input generation.
        binding.sourceHash ??= this.executor.hashSource(
          binding.input,
          variant.priority
        );
        return await Promise.all([
          binding.sourceHash,
          this.executor.hash(policy),
          this.executor.hash(request.mailboxId),
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
        const artifactValid = () => !this.disposed && this.hasConsumers(key);
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

  private hasConsumers(key: string): boolean {
    return [...this.bindings.values()].some(
      (binding) =>
        binding.current &&
        [...binding.variants.values()].some(
          (variant) => variant.key === key && variant.consumers > 0
        )
    );
  }

  private priorityFor(key: string): number {
    let priority = Infinity;
    for (const binding of this.bindings.values())
      for (const variant of binding.variants.values()) {
        if (binding.current && variant.key === key && variant.consumers)
          priority = Math.min(priority, variant.priority);
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
    const storage = await this.getStorage();
    if (storage && valid()) {
      const cached = await storageDeadline(storage.store.read(key));
      if (!valid()) throw cancelled();
      if (validArtifact(cached, key, sourceHash, policyHash)) {
        return this.memory.publish(key, cached.body);
      }
      if (cached !== undefined) void storageDeadline(storage.store.remove(key));
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
      bytes: 2 * body.html.length + 1024,
      lastUsed: Date.now(),
    };
    const persist = async () => {
      const storage = await this.getStorage();
      if (!storage || !valid()) return;
      const association = {
        id,
        threadId: request.threadId,
        mailboxId: request.mailboxId,
        sourceHash,
        keys: [key],
      };
      try {
        await storage.store.write(storage.generation, artifact, association);
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
              await storage.store.write(
                storage.generation,
                artifact,
                association
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
        if (variant.consumers || variant.pending) continue;
        binding.variants.delete(policy);
        const bytes = policy.length * 2 + 512;
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
          (variant) => variant.consumers || variant.pending
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

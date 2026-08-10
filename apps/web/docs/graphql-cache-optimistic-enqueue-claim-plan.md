# GraphQL Cache: Coupled Optimistic Enqueue and Initial Claim

Status: **implementation plan**

Base: implement after the reduced-inspection-cloning change (`wtomruqy`, currently described as `complete EntityKey Cow migration`).

Related design: [`graphql-normalized-cache-plan.md`](./graphql-normalized-cache-plan.md)

## 1. Problem

Starting an optimistic cache update and starting its durable mutation runner are currently exposed as separate host operations:

1. `beginOptimisticWrite` durably enqueues the mutation and publishes its optimistic layer.
2. The cache worker/native plugin broadcasts `ops-affected`.
3. Those pushes synchronously cause user-visible cache reads.
4. The exchange later schedules `claimNextMutation` through `setTimeout(0)`.
5. The single cache engine may therefore spend about 50 ms denormalizing an affected query before it can claim the mutation and let urql send the network request.

The `Zen 2026-08-07 09.19` profile showed this sequence on a slow property change:

```text
click
  inspect variants                         ~10 ms
  membership read                           ~4 ms
  begin optimistic write                   ~27 ms
  affected active-query read               ~52 ms
  UI/DnD layout                            ~12 ms
  mutation network request starts         ~158 ms after click
```

The worker scheduler currently assigns:

- cache writes: priority 2;
- user-visible reads: priority 1;
- `claim-next-mutation`: priority 0.

Raising claim priority alone is insufficient because `begin-optimistic-write` fans out affected operations before returning. The affected read can already be running when the claim request is created.

## 2. Decision

Replace the public `beginOptimisticWrite` operation with one application-level operation:

> **Durably enqueue an optimistic mutation and attempt to claim the strict queue head before publishing affected operations.**

Use a name such as `enqueueOptimisticMutation` throughout the host/protocol surface. Keep standalone `claimNextMutation` for background queue draining, startup recovery, retries, and advancing after settlement.

The initial implementation may use two storage transactions while holding the same serialized engine lock:

1. enqueue mutation plus optimistic layer;
2. attempt to claim the queue head.

Do **not** add `enqueue_mutation_and_claim` to the storage trait in this change. A crash between the transactions is safe: the mutation remains durably queued and can be claimed later. Storage-level atomic enqueue-and-claim is a possible follow-up only if profiling shows a need.

## 3. Required invariants

The implementation must preserve all of these:

1. The network mutation is never forwarded without a durable lease claim.
2. The optimistic layer and mutation request remain atomically enqueued as they are today.
3. The initial claim attempt completes before `ops-affected` or cache-change notifications are published.
4. Strict queue order remains unchanged: a leased, deferred, or otherwise non-runnable head blocks every later mutation.
5. If an older unclaimed mutation is at the head, the result may claim that older mutation; the newly enqueued operation is reported as queued.
6. If the head is already leased or deferred, the new optimistic layer remains visible but the new operation is reported as queued.
7. A failure during the claim step must **not** turn the already-enqueued mutation into an ordinary unqueued network request.
8. Initial/continuation grouped-page patching, link-patch fallback, and post-success revalidation semantics remain unchanged.
9. The browser SharedWorker and Tauri native host expose equivalent behavior.
10. Standalone queue draining and retry/settlement behavior continue to work after the initial composite operation.

## 4. Proposed result types

Use an explicit tagged claim outcome instead of an optional claim. The caller must be able to distinguish “head is not runnable” from “the claim attempt failed after enqueue succeeded.”

Conceptual TypeScript types:

```ts
export type InitialMutationClaim =
  | { kind: 'claimed'; mutation: ClaimedMutation }
  | { kind: 'not-runnable' }
  | { kind: 'failed'; error: string };

export type EnqueueOptimisticMutationResult = OptimisticWriteResult & {
  initialClaim: InitialMutationClaim;
};
```

The existing `OptimisticWriteResult` fields remain available:

- `transactionId` identifies the newly enqueued mutation;
- `changed` and `affectedOps` describe the newly visible composed cache view;
- `revalidations` retains its current meaning.

Interpretation:

- `initialClaim.kind === 'claimed'` and claim id equals `transactionId`: forward the live operation immediately.
- `initialClaim.kind === 'claimed'` and claim id differs: replay the older claimed head and return the new operation as queued.
- `not-runnable`: return the new operation as queued and retain/schedule background draining.
- `failed`: report the claim error diagnostically, return the new operation as queued, and schedule background draining. Never forward it outside the durable runner.

## 5. Rust core design

Primary files:

- `crates/client/cache-core/src/engine.rs`
- `crates/client/cache-core/src/queue.rs` if common result types belong there
- `crates/client/cache-core/tests/optimistic.rs`
- `crates/client/cache-core/tests/mutation_queue.rs`

Add a composite engine method such as:

```rust
pub async fn enqueue_optimistic_mutation(
    &mut self,
    origin_op: Option<OpId>,
    input: BeginOptimisticWrite<'_>,
    claim: MutationClaimRequest,
) -> Result<EnqueueOptimisticMutationResult<EngineError<S::Error>>, EngineError<S::Error>>;
```

A generic result shape can preserve the partial claim error without converting core errors to strings:

```rust
pub enum InitialClaimOutcome<E> {
    Claimed(ClaimedMutation),
    NotRunnable,
    Failed(E),
}

pub struct EnqueueOptimisticMutationResult<E> {
    pub transaction_id: OptimisticTransactionId,
    pub write_result: WriteResult,
    pub initial_claim: InitialClaimOutcome<E>,
}
```

Implementation order:

```text
begin_optimistic_write(...).await?          // top-level failure: no successful result
claim_next_mutation(claim).await            // nested outcome; do not discard begin result
return enqueue result
```

Important error rule: once `begin_optimistic_write` succeeds, an error from `claim_next_mutation` becomes `InitialClaimOutcome::Failed`; it must not become the outer `Err`. Otherwise the exchange could incorrectly degrade to an ordinary network mutation even though durable user intent already exists.

The existing low-level `begin_optimistic_write` and `claim_next_mutation` methods may remain available internally and for focused tests. The browser and Tauri host paths must use the composite method.

Do not change the `Storage` trait or any IndexedDB/SQLite queue schema in this phase.

## 6. WASM boundary

Primary files:

- `crates/client/cache-wasm/src/shell.rs`
- `apps/web/src/lib/graphql-cache/worker/wasm-module.ts`

Replace the generated-facing `beginOptimisticWrite` method with `enqueueOptimisticMutation`. Add claim inputs:

- `leaseOwner`
- `nowMs`
- `leaseExpiresAtMs`

The WASM shell must:

1. parse mutation and claim inputs;
2. hold the engine mutex across the composite engine method;
3. convert the nested claim outcome to the tagged JavaScript wire shape;
4. serialize a claim error as a diagnostic string while still resolving the enqueue request successfully.

Keep `claimNextMutation` for background drains.

Run the actual wasm32 build; native `cargo test -p cache-wasm` alone does not exercise the generated WASM interface.

## 7. Browser protocol and worker

Primary files:

- `apps/web/src/lib/graphql-cache/protocol.ts`
- `apps/web/src/lib/graphql-cache/worker/worker-core.ts`
- `apps/web/src/lib/graphql-cache/worker/wasm-module.ts`
- `apps/web/src/lib/graphql-cache/worker/worker-core.test.ts`

Replace the worker request variant:

```text
begin-optimistic-write
```

with:

```text
enqueue-optimistic-mutation
```

Include the initial claim request fields in the same message.

Worker dispatch must:

1. await `engine.enqueueOptimisticMutation(...)`;
2. only after that resolves, call `fanOut(result, true)`;
3. return the composite result to the requesting port.

Because the claim attempt is complete before `fanOut`, affected reads may start immediately without blocking mutation routing.

Update `requestPriority`:

- `enqueue-optimistic-mutation` is `CACHE_WRITE_PRIORITY`;
- standalone `claim-next-mutation` is also `CACHE_WRITE_PRIORITY` because it mutates the durable lease and must outrank observational reads.

Keep FIFO behavior among requests with equal write priority. Do not make claim a lifecycle barrier.

## 8. CacheHost implementations

Primary files:

- `apps/web/src/lib/graphql-cache/host/types.ts`
- `apps/web/src/lib/graphql-cache/host/worker-host.ts`
- `apps/web/src/lib/graphql-cache/host/tauri-host.ts`
- `apps/web/src/lib/graphql-cache/host/noop-host.ts`
- corresponding host tests

Replace:

```ts
beginOptimisticWrite(args)
```

with an API such as:

```ts
enqueueOptimisticMutation(
  args: EnqueueOptimisticMutationArgs,
  claim: {
    owner: string;
    nowMs: number;
    leaseExpiresAtMs: number;
  }
): Promise<EnqueueOptimisticMutationResult>;
```

The exchange should compute `nowMs` once and derive both the enqueue timestamp and lease expiration consistently. It is acceptable for transport adapters to continue adding `createdAtMs`, but tests should use deterministic times rather than multiple independent `Date.now()` calls.

The no-op host remains disabled and throws if this operation is called, matching current optimistic behavior.

## 9. Tauri native path

Primary files:

- `apps/web/tauri/graphql_cache_plugin/src/engine.rs`
- `apps/web/tauri/graphql_cache_plugin/src/commands.rs`
- `apps/web/tauri/graphql_cache_plugin/src/lib.rs`
- `apps/web/tauri/graphql_cache_plugin/src/engine/test.rs`
- `apps/web/tauri/src-tauri/src/lib.rs`
- `apps/web/src/lib/graphql-cache/host/tauri-host.ts`
- `apps/web/src/lib/graphql-cache/host/tauri-host.test.ts`

Add/rename the Tauri command to:

```text
graphql_cache_enqueue_optimistic_mutation
```

The `EngineHandle` must hold its existing async mutex across enqueue and initial claim by calling the composite core method.

The command must emit `ops-affected` and `cache-changed` only after the composite method returns, meaning the claim attempt has completed. It may emit events before returning the IPC response; this is safe once the durable claim no longer depends on another engine request.

Update command registration in `apps/web/tauri/src-tauri/src/lib.rs` and exports/documentation in the plugin crate. Keep the standalone claim command registered for background draining.

## 10. Exchange routing refactor

Primary files:

- `apps/web/src/lib/graphql-cache/exchange/normalized-cache-exchange.ts`
- `apps/web/src/lib/graphql-cache/exchange/normalized-cache-exchange.test.ts`

Extract the existing “route a claimed queue head” block from `drainQueue()` into one helper used by both:

- `drainQueue()` for background claims;
- `prepareMutation()` for the initial claim returned by enqueue.

The helper must preserve current behavior:

1. set `attemptInFlight = true`;
2. create the `QueueAttemptContext`;
3. if the claim matches a live operation, forward that exact operation with the queue-attempt context;
4. otherwise reconstruct and replay the durable mutation through `client.mutation`;
5. resolve every other live operation as queued;
6. roll back a claim if replay construction throws;
7. let settlement schedule the next drain.

Suggested `prepareMutation()` flow:

```text
build optimistic args
compute now and lease expiration
enqueueOptimisticMutation(...)
register the returned transaction id in liveQueuedOps
switch initialClaim:
  claimed       -> route the claim immediately
  not-runnable  -> resolve new/live operations as queued; retain background drain
  failed        -> call onCacheError; resolve as queued; schedule background drain
await/return the routed result
```

Do not call `scheduleDrain()` after a successful initial claim. The network settlement path already schedules the next queue drain.

If the claimed id differs from the newly enqueued transaction id, replay the older head and resolve the new operation as queued.

### Link-patch fallback

Preserve the existing retry that removes link patches when a cached bin/page disappears before enqueue. The distinction between outer enqueue failure and nested initial-claim failure is critical:

- outer enqueue failure may take the existing no-link-patch fallback path;
- `initialClaim.kind === 'failed'` means enqueue succeeded and must never enqueue a duplicate or bypass the queue.

## 11. Tests

### Cache core

Add focused tests for:

1. Empty queue: enqueue returns a claim whose id equals the new transaction id.
2. Older unclaimed head: enqueueing a new mutation claims the older strict head, not the new entry.
3. Actively leased head: new layer is visible but initial claim is `NotRunnable`.
4. Deferred head: later mutation is not skipped.
5. Claim storage error after successful enqueue: result is `Failed`, and the mutation/layer remain durably queued exactly once.
6. Existing commit, rollback, retry, hydration, and strict ordering behavior remains unchanged.

Use a fault-injecting test `Storage` wrapper for the partial claim failure case; do not weaken production error handling to make the test easier.

### Worker core

Add tests proving:

1. affected pushes are not emitted until the composite engine promise resolves;
2. a queued user-visible read cannot run between enqueue and initial claim;
3. standalone claim has write priority over queued observational reads;
4. claimed/not-runnable/failed outcomes pass through unchanged;
5. write FIFO and lifecycle barriers remain unchanged.

### Browser worker host

Assert the new request contains:

- mutation data;
- `owner`;
- `nowMs`;
- `leaseExpiresAtMs`;
- the new request kind.

Keep timeout semantics for this mutating request: do not add a read-style timeout that could cause an uncertain durable operation to be retried.

### Tauri host/plugin

Test:

1. command argument and result casing;
2. claim outcome serialization;
3. events are emitted after the claim attempt;
4. standalone drain command remains available;
5. old strict queue tests still pass.

### Exchange

Cover at least:

1. New mutation claims itself and the original live operation is forwarded without a standalone claim call.
2. Returned claim belongs to an older transaction: older durable mutation is replayed; new caller receives `queued`.
3. No runnable claim: new caller receives `queued`, no raw network request is made.
4. Claim failure after enqueue: error is reported, caller receives `queued`, no duplicate enqueue and no raw network request.
5. Two concurrent optimistic mutations preserve strict order and only one network attempt runs.
6. Retryable failure/defer still blocks later mutations until eligible.
7. Commit/rollback still advances the queue through standalone draining.
8. Startup recovery still uses standalone `claimNextMutation`.
9. Missing grouped link targets still take the existing no-link-patch fallback and retain revalidations.
10. Affected query re-execution still occurs; it is reordered after the initial claim, not removed.

## 12. Verification commands

Run from the repository root in the project development environment:

```bash
cargo fmt --check
cargo test -p cache-core -p cache-idb -p cache-sqlite -p cache-wasm
just build-cache-wasm
bun type-check
```

Run the focused frontend tests for:

- `normalized-cache-exchange.test.ts`
- `worker-core.test.ts`
- `worker-host.test.ts`
- `tauri-host.test.ts`
- grouped optimistic property tests

Then run the Tauri plugin tests using the Linux Tauri shell:

```bash
nix develop .#tauri-linux --command cargo test \
  --manifest-path apps/web/tauri/graphql_cache_plugin/Cargo.toml
```

Use the repository-required targeted service/package test commands rather than running database migrations. This change requires no SQLx migration and no SQLx query-cache update.

After successful verification, follow repository policy:

```bash
jj desc -m "perf(cache): claim optimistic mutations before affected reads"
jj new
```

## 13. Profiling acceptance criteria

Capture another Firefox profile using the same repeated grouped-property interaction.

Required observations:

1. The initial durable claim completes before the first `ops-affected` cache read begins.
2. `SetEntityProperty` network dispatch does not wait for the approximately 50 ms affected active-query `read_query`.
3. There is no standalone `claim-next-mutation` RPC for a freshly enqueued mutation that returned an initial claim.
4. Every network mutation still carries a valid queue-attempt context.
5. IndexedDB work before network dispatch remains bounded; no unrelated record reads return.
6. Optimistic grouped movement remains visible and initial/continuation/revalidation semantics are unchanged.
7. Target the former 158–171 ms slow interactions to approach the existing approximately 30 ms fast path; as an environment-tolerant criterion, require network dispatch before the affected read completes and preferably under 100 ms click-to-request.

## 14. Non-goals

Do not include these in this change:

- storage-level atomic enqueue-and-claim;
- removal of standalone queue draining;
- compact Rust-side grouped membership inspection;
- optimization of full active-query denormalization or Rust-to-JS serialization;
- closing the property editor before network completion;
- changes to grouped paging, link-patch applicability, or revalidation policy;
- database migrations.

## 15. Architectural boundary check

This work is cache-engine and adapter orchestration, not application authorization or business policy. `cache-core` owns durable mutation queue invariants; WASM/Tauri and worker hosts adapt that operation to their transports; the urql exchange decides how a returned claim is routed to the network. No inbound/domain/outbound service authorization boundary is changed.

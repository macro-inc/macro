# Prepared email cache

`EmailRenderCacheProvider` owns one service per verified viewer session. Email
features receive only an `EmailPreparation` capability: synchronous memory hits,
a pending completion promise, and a release function. Standalone views use direct
preparation. The PostHog flag is `enable-email-render-cache`, with the local
override `VITE_ENABLE_EMAIL_RENDER_CACHE`. It defaults on only for local stacks.

Exact primitive body fields select a bounded message binding. WebCrypto hashes the
framed source tuple; preparation version, image/quote policy hash, and mailbox
hash select an immutable artifact. The database namespace hashes origin,
environment, profile scope, and verified viewer identity.

Memory leases pin active results; unretained results use byte-accounted LRU.
Starting budgets are 16 MiB desktop / 8 MiB mobile, including retained input
tuples. Active bodies may exceed that limit until their leases are released.
Speculation queues at most 32 preparations and skips inputs over 256 KiB of
estimated retained input storage. One parser runs at a time; queued priorities
can change, but an active synchronous parse is not preempted.

Browser persistence uses a separate IndexedDB database with artifact,
message-association, and durable-generation stores. Budgets are 128 MiB desktop /
32 MiB mobile, reduced when origin storage is constrained. Access metadata is
batched; over-budget entries are evicted by LRU. When the feature is enabled, the
authenticated session initializes storage ahead of body requests without fetching
source or preparing a body. A storage read has a 150 ms
deadline. Delivery precedes persistence. Quota failure discards only this derived
tier and retries once, then disables persistence for that service.

Invalidation cancels the old service synchronously. Every write checks its durable
generation in the same transaction as the commit. Failed clears quarantine the
namespace in local storage. Other tabs receive invalidation; an ended identity
cannot repopulate from its previously cached source. Namespace/logout ownership
remains active when the flag is disabled, so cold artifacts are still cleared.
Session revocation releases mounted bodies and their resources. The initial invalidation
policy conservatively clears the viewer's whole derived tier on message deletion,
mailbox removal, access denial, or completed shared-mail revocation reconciliation.
It preserves source caches and mutation queues, but may cause unrelated bodies to
reprepare after these uncommon events. Associations leave room for narrower
invalidation without changing artifact identity.

Foreground misses up to 512 KiB of estimated source storage use the already-loaded
main-thread parser; larger bodies and speculative preparation use the worker.
This starting bound includes all source fields, not just HTML. It avoids
making ordinary cold opens wait for worker startup, but does not guarantee a task
duration on slower devices. Foreground hashing uses WebCrypto directly; background
source hashing moves to the worker once it is ready. Persistent hits skip parsing
in both executors. Priority promotion is checked again when preparation starts.

The worker is lazy, independent of the normalized cache worker, and disables
further starts after an error or a 15-second watchdog. Native Tauri deliberately
uses the direct executor and memory only until actual WebKit/iOS worker and
storage behavior is validated. No preparation hint mounts a DOM or fetches images.

Run the `email-render-cache` Vitest project, the email primitive tests, and
`just test-email-rendering`. The integration checks also cover normalized-cache
reset propagation, source-query adapters, and quiet backfill hydration.

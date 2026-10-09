# Prepared email cache

`EmailRenderCacheProvider` owns one service per verified viewer session. Email
features receive only an `EmailPreparation` capability: synchronous memory hits,
a pending completion promise, and a release function. Standalone views use direct
preparation. The PostHog flag is `enable-email-render-cache`, with the local
override `VITE_ENABLE_EMAIL_RENDER_CACHE`. It defaults on only for local stacks.

The cache engine and coordination run without Solid. `session-runtime.ts` owns
browser storage, quarantine, cross-tab invalidation, and disposal from explicit
session inputs. The Solid provider reads auth/flag state, wires app events, and
registers cleanup. `email-view/preparation-window.ts` owns neighbor selection,
intent delay, and source retention; its Solid adapter only passes current values.
`email-thread/preparation.ts` selects and prepares bodies using an injected source
reader and image policy, with production queries supplied by its adapter.
These modules run in the Node test project without a Solid owner or DOM. The
session runtime uses browser APIs in production; framework-independent does not
mean side-effect-free.

Exact primitive body fields select a bounded message binding. WebCrypto hashes the
framed source tuple; preparation version, image/quote policy hash, and mailbox
hash select an immutable artifact. The database namespace hashes origin,
environment, profile scope, and verified viewer identity.

Memory leases pin active results; unretained results use byte-accounted LRU.
Starting budgets are 16 MiB desktop / 8 MiB mobile, including retained input
tuples. Active bodies may exceed that limit until their leases are released.
Speculation queues at most 32 live preparations and skips inputs over 256 KiB of
estimated retained input storage. One parser runs at a time; queued priorities
can change, but an active synchronous parse is not preempted. A variant runs at
its most urgent live lease's priority. A live lease whose shared job was
cancelled for others restarts it once; a lease that left only ever sees
cancellation. Speculation never replaces the source of a body someone is reading.
When the cache still cannot serve a mounted body, the body prepares directly, as
without the cache, and offers Retry only when that fails too.

Browser persistence uses a separate IndexedDB database with artifact,
message-association, and durable-generation stores. Budgets are 128 MiB desktop /
32 MiB mobile, reduced when origin storage is constrained. Access metadata is
batched; over-budget entries are evicted by LRU. When the feature is enabled, the
authenticated session initializes storage ahead of body requests without fetching
source or preparing a body. A storage read has a 150 ms
deadline. Delivery precedes persistence. Quota failure discards only this derived
tier and retries once, then disables persistence for that service.

Invalidation cancels the old service synchronously. Every write checks its durable
generation in the same transaction as the commit; a write that finds a newer
generation tells its session it missed an invalidation, which then heals as if
the broadcast had arrived. Clears hold a cross-tab Web Lock, and opening storage
reads the quarantine marker under it, so a clear in progress is waited out
rather than mistaken for a failed one. Failed clears quarantine the namespace in
local storage. A clear only ever empties an existing database; it never creates
one, and without IndexedDB it does nothing.

Invalidation reasons differ in reach. `reset` (inbox removal, access denial,
shared-mail revocation) clears storage and tells other tabs. `local` (sync
events and normalized-cache resets, which every tab receives itself) clears
without rebroadcasting. `session-ended` comes only from an explicit sign-out
(`clearLocalAuthSession`): other tabs stop caching for that identity, and auth
itself follows the app's own 401 handling. An unconfirmed 401 or an account switch
is never reported as a sign-out. A sign-out also removes the durable login
marker before its broadcast goes out, so storage opens, every write, and every
channel connect check it; a tab that missed the broadcast still never persists
for an identity the device signed out of. A tab resumes caching for an ended
identity only after the server confirms that identity signed back in.

Namespace/logout ownership remains active when the flag is disabled, so cold
artifacts are still cleared; a session that never opened storage skips the clear
when the browser lists no artifact database. The session follows the viewer and
invalidations, not the flag, so a flag that resolves after mount never clears
storage. Bodies are revoked only once the identity is cleared or replaced, never
on a raw 401. A new session cache keeps displayed bodies until their
replacements are ready, and an identical replacement does not rebuild the DOM.
The initial invalidation
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

`*.adversarial.test.*` files are regression tests from adversarial review,
including model-based fuzzers. Defaults keep them fast; raise `FUZZ_SEEDS`
(`FUZZ_FROM` to offset), `READER_FUZZ_SEEDS`, `ADV_SEEDS`, or `ADV_MODEL_SEEDS`
for long soaks, and `FUZZ_SEED` to replay one seed.

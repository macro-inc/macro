# outbound_pacing

## What it is

Shared infrastructure for calls Macro makes to a rate-limited provider
(GitHub first). Paces calls per opaque key, fails fast while a key is
blocked, holds briefly when a turn or unblock is close, and shares one run of
identical in-flight work.

## Start here

- `src/pacer.rs`: `Pacer::call` — wait for the key's turn, run the attempt,
  and on `Answer::Throttled` block the key and retry once inside the hold.
- `src/single_flight.rs`: `SingleFlight::run` over `futures::future::Shared`.

## Scope

- Owns: per-key pacing (`governor`), blocked-until records, the bounded hold,
  single-flight coalescing.
- Not here: reading a provider's answer (status codes, rate limit headers,
  caching) → the provider's adapter, e.g. `crates/github`
  `src/outbound/github_http.rs`. Limiting how often Macro's own users may act
  → `crates/rate_limit`.

## Boundaries

- Used by: `crates/github`.

## Checks

- `cargo test -p outbound_pacing`

## Gotchas

- Time is tokio's: governor runs on a `TokioClock`, so tests use
  `#[tokio::test(start_paused = true)]` and `tokio::time::advance`, never
  sleeps. Keep new waits on `tokio::time`, not `std` or `futures-timer`.
- State is per `Pacer` instance and per process; build one per provider and
  share it.
- Keys are opaque and held in memory; hash credentials before using them.

## Related

- Rules: `.agents/rules/rust/code.md` (CS-20, CS-66)

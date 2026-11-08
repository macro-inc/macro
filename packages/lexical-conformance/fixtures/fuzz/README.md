# WP-07 differential regression tapes

Each schema-1 tape retains the minimized command prefix, seed and shrink path,
and the expected and actual snapshots captured at the original mismatch. Those
snapshots are diagnostic history; replay runs the commands against fresh pinned
upstream and WASM editors and compares every current result strictly.

The two tapes with an explicit `policy` record retain S1's surrogate-splitting
edit rejection boundary. Their prefixes compare in lockstep; the final edit must
fail atomically in Rust. Interior UTF-16 selection offsets have ordinary parity
regressions. These tapes are independent of the recorder's admitted Tier A schema.

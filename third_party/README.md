# third_party

Local forks of third-party crates, applied through `[patch.crates-io]` in the
root `Cargo.toml`. Deliberately vendored into this repo rather than pushed as
fork repositories: the changes are small, and a path patch is reproducible for
anyone with a checkout and invisible to everyone who does not care.

Each fork keeps its upstream source verbatim except where a comment says
`LOCAL FORK`, so a diff against the crates.io release is the whole change.

| Crate | Version | Change |
|---|---|---|
| `agent-client-protocol` | 1.2.0 | `async-process` made optional behind a default-on `subprocess` feature |

## agent-client-protocol

`agent_fold` compiles to wasm so the browser can fold agent sessions itself
(`crates/client/agent-fold-wasm`). Upstream 1.2.0 depends on `async-process`
unconditionally, which reaches `async-io` → `rustix` → `errno`, and `errno` is
a hard `compile_error!` on `wasm32-unknown-unknown`.

Only `src/acp_agent.rs` uses it, to spawn an agent as a child process — which a
browser will never do. So the module and the dependency now sit behind a
`subprocess` feature that is **on by default**: every native consumer builds
exactly as before, and the wasm build takes `default-features = false`.

Upstream has published 2.0.0. If that release makes the dependency optional (or
drops it), this fork should go away in favour of the upgrade.

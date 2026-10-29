# agent_preview

## What it is

Part of agent sessions: lets an agent session's dev server be viewed live
by other people. Leases an entity-authorized preview and proxies
HTTP/WebSocket traffic (including Vite HMR) to viewers over a tunnel built
on stock OpenSSH reverse forwarding.

## Start here

- `src/domain/service.rs` + `src/domain/ports.rs`: lease/authorization
  policy, independent of HTTP and SSH.
- `src/domain/storage.rs` + `src/outbound/postgres.rs`: shared metadata,
  credential hashes and fenced SSH ownership; live transports stay local.
- `src/inbound/peer.rs`: one-hop streaming HTTP/WebSocket forwarding.
- `src/inbound/ssh.rs`: accepts the sandbox's reverse SSH tunnel.
- `src/inbound/http.rs`: serves the proxied preview to viewers.
- `src/outbound/ssh_tunnel.rs`: the SSH transport implementation.
- `src/inbound/toolset.rs`: the AI tool surface (`SharePreview`).

## Scope

- Owns: leasing a preview to an entity, authorizing viewers, and proxying
  HTTP/WebSocket traffic (including Vite HMR) over the tunnel.
- Not here: credential stamping on the sandbox side → `agent_egress`.

## Boundaries

- Depends on: `agent_egress` (shares the sandbox's egress credential path).
- Used by: `agent_harness_service` (its sole host).

## Recipes

- Add a preview policy: `src/domain/service.rs` → `src/domain/ids.rs` if a
  new id shape is needed → `src/inbound/control.rs` for the control API.

## Checks

- `cargo test -p agent_preview` (`SQLX_OFFLINE` unset).

## Gotchas

- Every host must heartbeat its private HTTP endpoint every 10 seconds; expired
  owners are offline after 45 seconds. Preview IDs fence replacement/cleanup.
- Public peers must be mutually reachable; destinations come only from the
  shared replica registry. A hop marker only prevents loops and never grants auth.
- Queue owner-side per-preview HTTP streams for Vite module fan-out (see
  `src/inbound/http.rs`); replica-wide unauthenticated forwarding admission
  rejects overload before dialing to bound waiting requests and sockets.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`

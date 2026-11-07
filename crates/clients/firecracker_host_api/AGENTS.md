# firecracker_host_api

## What it is

The REST contract of the Firecracker host agent (`services/firecracker_host`)
for Macro computers: the requests `hosted_runtimes`' `FirecrackerFleet` sends
over mTLS, the answers, the exec protocol, and the MMDS document guests read.

## Start here

- `src/lib.rs`: power states and idempotency. Routes are declared by the
  agent's router (`services/firecracker_host/src/inbound/axum_router.rs`,
  OpenAPI via `firecracker_host_openapi`).
- `src/client.rs` (feature `client`): `HostClient`, the one client
  (`firecracker_host.request` span per call, pinned mTLS); feature
  `test-support` adds `HostClient::over_plain_http`.
- `src/computer.rs`: create, enrollment, and `Computer`.
- `src/exec.rs`: exec frames, shared by the control-plane WebSocket and the
  vsock link to `services/firecracker_guest_agent`.
- `src/mmds.rs`: the guest's MMDS document (snake_case: the guest's contract).
- `src/moves.rs`: moving a computer between hosts: the control plane's
  requests and the agent-to-agent peer protocol (JSON line + raw `zfs send`
  stream over the WireGuard mesh).

## Scope

- Owns: wire types (`schema` feature: `utoipa::ToSchema`), error codes, the
  client. HTTP statuses are the agent's (inbound).
- Not here: the agent (`services/firecracker_host`), fleet policy
  (`crates/hosted_runtimes`), the guest side (`nix/macro-box`).

## Gotchas

- `mmds.rs` keys must match `nix/macro-box/files/macro-restore` and
  `hosted_runtimes::domain::enrollment::MMDS_ENROLLMENT_PATH`.
- A golden fixes vCPUs and memory, so goldens are keyed by image and shape
  (`GoldenKey`).

## Boundaries

- Used by: `firecracker_host` (types, schema, contract test),
  `hosted_runtimes` (`FirecrackerFleet` wraps `HostClient`).

## Checks

- `cargo test -p firecracker_host_api`
- `cargo test -p firecracker_host` runs the client against the real router
  (`the_client_and_the_router_agree_on_every_route`): a route or body change
  must keep it green.

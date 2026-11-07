# pinned_tls

## What it is

Macro computers on Firecracker: mTLS between the control plane and each
host agent, both with self-signed certificates. `client_config` presents the
control plane's certificate and trusts exactly one pinned agent certificate;
`server_config` presents the agent's and accepts only pinned control-plane
certificates.

## Boundaries

- Used by: `firecracker_host_api` (`HostClient`), `firecracker_host`
  (the agent's listener).

## Checks

- `cargo test -p pinned_tls`

## Gotchas

- Byte equality with a pinned certificate is the whole trust decision; never
  add name or chain checks, and never fall back to system roots.

# firecracker_guest_agent

## What it is

Macro computers on Firecracker: the root daemon in the guest that runs
programs for the host agent (`services/firecracker_host`) over vsock port
1024, the role `incus exec` plays for Incus guests. `nix/macro-box` runs it.

## Start here

- `src/session.rs`: one exec; protocol in `firecracker_host_api::exec`.

## Gotchas

- Only the host can open a guest's vsock, so there is no authentication: the
  host agent is the only peer. Never expose it on a network socket.
- The program's environment is exactly the request's; nothing is inherited.
- It exports no traces: each exec's span carries the host agent's
  `trace_id`, so its "exec started" and "exec ended" journal lines are found
  from the host's trace.

## Checks

- `cargo test -p firecracker_guest_agent`

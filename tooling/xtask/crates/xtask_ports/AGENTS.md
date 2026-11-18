# xtask_ports

## What it is

Local stacks: where each instance's host ports and Docker subnets go, so any
number of named instances run on one machine without anyone picking a
`--port-base`. `xtask_local` reads Docker and calls this; this crate never
talks to Docker, so every decision is testable from plain data.

## How it works

A start takes `Registry::lock()` (a flock on
`~/.local/state/macro-local/instances.lock`), reads a `Machine` snapshot, and
`Locked::allocate` picks a window (its containers' window, then its last
record, then the hashed one, then the next free) and a `10.254.<n>.0/24` clear
of live networks and host routes, then records both with the owner's pid. The
same call after the build is the recheck. Teardown calls `Locked::release`.

## Start here

- `src/layout.rs`: the `Port` list and window and subnet layout.
- `src/registry.rs`: the lock, the record file, and `allocate`.

## Scope

- Owns: port offsets, window and block choice, the registry, the leftover
  census, the bind and connect probes.
- Not here: reading Docker, instance and network names, CLI flags →
  `xtask_local/src/local/allocator.rs` and `instance.rs`.

## Checks

- `cargo test -p xtask_ports`
- `cargo test -p xtask_local --features local-stack`

## Gotchas

- Append new `Port` variants: offsets are declaration order, and inserting one
  moves every running named instance's later ports.
- Changing `fnv1a`, `WINDOW_START`, `STRIDE` or the block layout moves existing
  instances; `layout/test.rs` pins the values.
- Registry tests run the test binary again as child processes
  (`registry::test::child_process`); a new child role goes there.
- Collision tests hold their own listeners on ports the OS picks; never assume a
  fixed port is free on the box.
- `probe::bindable` binds `0.0.0.0`; on macOS that succeeds beside a server bound
  to loopback, so use `probe::accepting` to find a squatter.

## Related

- Docs: [`docs/development/running-locally.md`](../../../../docs/development/running-locally.md)
  (port windows and subnets), [`docs/guides/new-service.md`](../../../../docs/guides/new-service.md) step 6

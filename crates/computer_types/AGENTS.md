# computer_types

## What it is

Macro computers: values shared by the control plane (`hosted_runtimes`) and
the Firecracker host agent's contract (`firecracker_host_api`):
`EnrollmentGeneration`, `ControlPlaneId`, `GuestImage`. Validated on
construction and deserialization.

## Boundaries

- Used by: `firecracker_host_api`, `firecracker_host`, `hosted_runtimes`
  (re-exports them where its callers expect them).

## Checks

- `cargo test -p computer_types`

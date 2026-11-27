# agent_mailbox_fake_vendor

## What it is

Part of agent mailboxes: an in-memory fake of the deadsimple.email REST routes
the `agent_mailbox` adapter uses, for local stacks and previews without a
provider key. No real mail moves; every response carries `x-fake-vendor: not-live`.

## How it works

Mail between two fake mailboxes is delivered in memory; mail to any other
address lands in `/fake/outbox`. `POST /fake/deliver` (provisioning key)
simulates mail from outside. A scoped key sees only its own mailbox.

## Scope

- Used by: `xtask_local` (`agent_mailbox_fake_vendor.rs`), which runs it as a
  sidecar when the stack has no real `DEADSIMPLE_API_KEY`.

## Checks

- `cargo test -p agent_mailbox_fake_vendor`: the real adapter against the fake.

## Gotchas

- Keep its shapes in step with `agent_mailbox/src/outbound/deadsimple.rs`; the
  tests run that adapter against it.

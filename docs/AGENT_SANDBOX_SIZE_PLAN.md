# Agent Sandbox Sizes (small / default / large)

## Status

Implementation plan. No code or schema changes have been made as part of this document.

## Problem

Macro Coder sessions always get one Daytona size, and that size is not chosen in product code. It is baked into the snapshot:

- `crates/agent_harness/justfile` `ensure-daytona` creates `macro-agent-harness` with `--cpu 4 --memory 8 --disk 10`.
- The justfile still comments that 10GB disk was the account ceiling. That quota is now raised.
- `POST /sandbox` in `crates/agent_harness/src/outbound/daytona/client.rs` sends only `snapshot`, `env`, `labels`, and `autoStopInterval`. It does not send CPU, RAM, or disk.
- The Namespace provider hardcodes 2 vCPU / 4GB RAM and has no disk field.
- `SpawnContainer` carries `session_id` and `repo_url` only.
- `agent_session` stores model, harness, repo, and workspace, not sandbox size.
- Macro Coder sessions are opened by the mention trigger. `POST /agent-sessions` rejects managed bots. There is no UI or API for a user to pick a size.

The wanted product is three named tiers (`small`, `default`, `large`), with `default` being 8 vCPU / 16 GiB RAM / 96 GiB disk, and a way for a user to choose a tier that future `@coder` sessions actually use.

## Decisions

1. **Named tiers, not raw integers.** The domain type is `SandboxSize::{Small, Default, Large}`. UI and API never send `cpu` / `memory` / `disk`. Those numbers are a provider mapping owned by the harness domain.
2. **`default` is 8 / 16 / 96.** That is the new Macro Coder size. `small` and `large` are scaled off it (numbers below; confirm `large` against the live Daytona quota before shipping it).
3. **One snapshot, size at sandbox create.** Do not build three snapshots. Rebuild `macro-agent-harness` at the default (or largest) resource profile, and pass `cpu` / `memory` / `disk` on every `POST /sandbox`. Namespace maps the same tier onto `virtual_cpu` / `memory_megabytes`.
4. **Size is snapshotted onto the session at spawn and is immutable for that session.** Changing size does not resize a live sandbox in v1. Resume reattaches to the existing box. A new `@coder` thread gets a new session and can use a new size.
5. **User default drives mention spawn.** `@coder` has no settings chrome. The harness reads the mentioning user's default size (falling back to `default`) and writes it onto the new session before `spawn`.
6. **Sandbox size is not an `AgentAction`.** `AgentAction` is ACP (`prompt`, `set_model`, `compact`, `stop`). Size is harness/container policy. Do not send it to the agent. Use a dedicated settings endpoint for the user default, and a field on the session response for the size this session was spawned with.
7. **Policy lives in the harness domain.** Inbound parses the tier. Domain validates it, resolves the user default, and puts it on `SpawnContainer`. Outbound adapters only map a validated size onto provider fields. Hexagonal boundary: no Daytona/Namespace types in domain, no size policy in axum handlers or the web picker.

## Goals

- Every new Macro Coder sandbox is 8 vCPU / 16 GiB / 96 GiB unless the user picked `small` or `large`.
- `GET` session includes `sandboxSize`.
- A user can set their default size; the next `@coder` mention uses it.
- Unknown or raw resource payloads are rejected at the API boundary.
- Daytona and Namespace both honor the same three tiers.
- Existing sessions keep working: a NULL/missing size on old rows means `default` at the new resource mapping only for *new* spawns. Already-running sandboxes stay at whatever Daytona already gave them.

## Non-goals (v1)

- Mid-session Daytona `resize`.
- Per-team or per-org size caps beyond "only these three tiers".
- Billing, metering, or showing remaining Daytona quota in the UI.
- GPU tiers.
- Letting external (non-managed) agent runtimes declare a size. They bring their own machine.
- Putting a size picker in the `@` mention typeahead.
- Recreating a live sandbox when the user changes their default.

## Resource mapping

Units match Daytona: CPU cores, memory GiB, disk GiB.

| Tier      | vCPU | RAM | Disk | Notes                                      |
| --------- | ---- | --- | ---- | ------------------------------------------ |
| `small`   | 2    | 4   | 20   | Cheap / short tasks                        |
| `default` | 8    | 16  | 96   | The new Macro Coder size                   |
| `large`   | 16   | 32  | 200  | Confirm against Daytona quota before ship  |

Namespace has no disk dimension. It gets vCPU + RAM only (`virtual_cpu`, `memory_megabytes` = RAM GiB × 1024). Disk stays whatever Namespace gives the instance.

If the live Daytona quota cannot place `large`, ship `small` + `default` only and keep `Large` out of the public enum until it can.

## Product behavior

### New `@coder` mention

1. Trigger pipeline opens a managed session as it does today.
2. Harness loads the sender's default `SandboxSize`, or `Default`.
3. Session row is created with that size.
4. `spawn` passes the size to the container manager.
5. Daytona create includes `cpu` / `memory` / `disk` for that tier.

### User default

- Owner-only. Stored server-side, not in `localStorage` — mention spawn is backend-only and would ignore a browser preference.
- New endpoint, not `POST /agent-sessions` (that route still rejects managed bots) and not `/control` (that route is ACP).
- Suggested shape:
  - `GET /agent-sandbox-size` → `{ size: "small" | "default" | "large" }`
  - `PUT /agent-sandbox-size` `{ size }` → same
- First-time users have no row; reads return `default`.

### Existing session UI

- Session header shows the size this session was spawned with (read-only pill).
- The same control also sets "for new sessions" by calling `PUT /agent-sandbox-size`.
- Copy: changing the picker does **not** resize the open session. Next `@coder` thread uses the new size.
- No size picker in the mention typeahead.

### Resume / idle stop

- Idle reaper still stops the sandbox; resume starts the same Daytona id.
- Do not re-apply size on resume. The box already has a size.
- Teardown + a brand-new session is the only v1 way to get a different size.

## Domain design

### `SandboxSize`

New domain enum in `crates/agent_harness` (owned there, not in `agent_session` ACP types):

```rust
pub enum SandboxSize {
    Small,
    Default,
    Large,
}
```

- Serde/API: `"small" | "default" | "large"`.
- `Default` for `#[default]` and for missing DB values.
- `resources(self) -> SandboxResources { cpu, memory_gib, disk_gib }` is domain data, not an outbound DTO.

`agent_session` may store the enum as text on the row and echo it on `AgentSessionResponse`. It should not know Daytona field names.

### `SpawnContainer`

Add `size: SandboxSize`. Both Daytona and Namespace managers read it. Fakes in harness tests must too.

### Session row

Migration on `agent_session`:

```sql
ALTER TABLE agent_session
    ADD COLUMN sandbox_size TEXT NOT NULL DEFAULT 'default'
        CHECK (sandbox_size IN ('small', 'default', 'large'));
```

Existing rows become `default`. That label does **not** resize already-created Daytona sandboxes.

### User default row

New table, not a column on `"User"`:

```sql
CREATE TABLE user_agent_sandbox_size (
    user_id TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
    sandbox_size TEXT NOT NULL
        CHECK (sandbox_size IN ('small', 'default', 'large')),
    modified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Port: `AgentSandboxSizePreference` with `get(user) -> SandboxSize` and `set(user, size)`. Missing row → `Default`.

### Authorization

- Reading a session's size: existing session view receipt.
- Setting the user default: the authenticated user, for themselves only. No team-admin override in v1.
- Spawn path is the mention trigger; it already trusts the observed sender. It must not take a size from the message body.

Inbound adapters mint identity / receipts and forward. They do not branch on "is this user allowed to pick large". If we later cap `large` per plan, that check belongs in the harness domain service.

## Provider mapping

### Daytona

`CreateSandboxRequest` gains:

```rust
cpu: u32,
memory: u32, // GiB
disk: u32,   // GiB
```

`configuration_parameters` takes `&SandboxResources` (or the three ints) from `SpawnContainer.size.resources()`. Keep `auto_stop_interval: 0`.

Snapshot create in `justfile` / `ensure-daytona` becomes `--cpu 8 --memory 16 --disk 96` so a create that *fails* to honor overrides still boots the wanted default. Rebuild the snapshot (delete + create); `snapshot create` will not replace an existing name.

Verify before the UI ships: one `POST /sandbox` with the existing snapshot plus `cpu`/`memory`/`disk` for `small`, then read the sandbox and confirm the quotas stuck. Daytona's SDK historically ignored resource overrides on snapshot creates; the REST docs now show those fields on `POST /sandbox`. If override is ignored, stop and switch to three named snapshots rather than shipping a picker that does nothing.

### Namespace

Replace the hardcoded `virtual_cpu: 2, memory_megabytes: 4096` with the tier mapping. No disk field.

### coding-agent-worker

Out of scope unless it is still used to boot Macro Coder. Production harness is `crates/agent_harness`. Do not silently fork a second size table there.

## API / SDK

- `AgentSessionResponse.sandboxSize`: `"small" | "default" | "large"`.
- New user-default routes on the agent harness service (same service that already owns managed sessions).
- OpenAPI in `agent_session` / `agent_harness_service` swagger, then `just coverage` / add-sdk-endpoint skill so `packages/sdk` and the web generated client pick it up.
- Do **not** add `sandboxSize` to `CreateAgentSessionRequest` in v1. That route is for external runtimes and rejects managed bots. Mention spawn is not that route.

## UI

- Feature stays behind `ENABLE_CHAT_V3_AGENTS`.
- Read-only size on `AgentSplitHeader` (or a small pill next to the harness title).
- Picker for the user default in that same header: Small / Default / Large, with RAM/disk in the menu subtitle so the names mean something.
- Changing the picker `PUT`s the user default and toasts that it applies to new sessions.
- Composer (`AgentInput`) stays a prompt box. Do not copy Macro AI's model picker into ACP control for this.

## Phasing

### 1. Default size bump (can ship alone)

- Snapshot flags → 8 / 16 / 96.
- Daytona create always sends those three fields.
- Namespace default mapping → 8 vCPU / 16 GiB.
- Tests: Daytona request JSON includes `cpu`/`memory`/`disk`; snapshot justfile comment about the 10GB ceiling is removed.
- No UI. Every new sandbox is `default`.

### 2. Domain + persistence + API

- `SandboxSize` enum, `SpawnContainer.size`, session column, user-default table.
- Mention `open` reads the user default.
- `GET`/`PUT /agent-sandbox-size`, session response field.
- Domain tests: missing preference → `Default`; `PUT` then mention uses the new size; unknown size → 422; outbound mapping for all three tiers on both providers.

### 3. UI picker

- Header pill + default-size menu.
- Generated client from phase 2.
- Copy that this session does not resize.

### 4. Later (not this plan)

- Daytona `resize` for CPU/RAM on a live session (disk grow-only).
- Team default / plan-gated `large`.
- "Restart this session at a new size" (teardown + new sandbox; loses the live workspace unless we snapshot first).

## Testing

- `cargo test -p agent_harness` for spawn mapping, preference fallback, and Daytona request body.
- `cargo test -p agent_session` for the new column on create/get fixtures.
- SQLX: `just prepare_db` after the migration, from the repo root, with `SQLX_OFFLINE` unset.
- Web: component test that the picker calls `PUT` and does not call session control.
- Manual: one real Daytona create per tier against the quota (phase 1 spike for override; phase 2 for `small` vs `default`).

## Risks

- **Snapshot resource override is a no-op.** Mitigate with the phase 1 spike. Fallback is three snapshots named `macro-agent-harness-{small,default,large}`.
- **`large` exceeds quota.** Keep it out of the public enum until a create succeeds.
- **Users think the picker resizes the open session.** Header copy + toast. Size on the session response is the spawned size, not the pending default.
- **Mention already spawned before the UI is visible.** That is why the picker edits the *next* session's default, not the current sandbox.
- **Namespace disk.** Document that `small`/`large` on Namespace only change CPU/RAM.

## Files (expected)

- `crates/agent_harness/justfile` — snapshot resources
- `crates/agent_harness/src/domain/model.rs` — `SandboxSize`, `SpawnContainer`
- `crates/agent_harness/src/domain/service.rs` — resolve user default on `open`
- `crates/agent_harness/src/outbound/daytona/client.rs` — `cpu`/`memory`/`disk`
- `crates/agent_harness/src/outbound/namespace/client.rs` — shape from tier
- `crates/agent_session/src/domain/model.rs` + postgres outbound — `sandbox_size` column
- `crates/macro_db_client/migrations/` — session column + `user_agent_sandbox_size`
- `crates/agent_session/src/inbound/axum_router.rs` — response field; new default-size handlers (or a small harness inbound module)
- `apps/web/src/features/block-agent/component/AgentSplitHeader.tsx` — pill + picker
- Generated OpenAPI / SDK clients after the new routes

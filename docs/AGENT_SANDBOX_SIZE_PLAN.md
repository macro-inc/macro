# Agent Sandbox Sizes (small / default / large)

## Status

Implemented. Named tiers, user default, in-place Daytona resize (hot up / cold down), and a size picker on the agent composer.

Disk is 96 GiB on every tier so a live session can hot-resize CPU/RAM without a disk migrate. Changing the picker resizes **this** sandbox and updates the user default for the next `@coder`.

## Problem

Macro Coder sessions always get one Daytona size, and that size is not chosen in product code. It is baked into the snapshot:

- `crates/agent_harness/justfile` `ensure-daytona` used to create `macro-agent-harness` with `--cpu 4 --memory 8 --disk 10`.
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
3. **One snapshot, size after create.** Do not build three snapshots. Rebuild `macro-agent-harness` at the default resource profile (`--cpu 8 --memory 16 --disk 96`). Daytona returns 400 if `cpu` / `memory` / `disk` are sent on `POST /sandbox` with a snapshot, so spawn creates from the snapshot, waits for start, and applies the named tier with `POST /sandbox/{id}/resize` (hot if CPU/RAM only increase, cold if either decreases). Disk is never sent on resize. Namespace maps the same tier onto `virtual_cpu` / `memory_megabytes` at create time.
4. **Size is snapshotted onto the session at spawn and can be changed in place when the manager allows it.** CPU/RAM upgrades are in-place on a running Daytona sandbox. Downgrades stop, resize, and start it again. Disk never changes. Local Docker and Namespace report `Unsupported` (no in-place resize).
5. **User default drives mention spawn.** `@coder` has no settings chrome. The harness reads the mentioning user's default size (falling back to `default`) and writes it onto the new session before `spawn`.
6. **Sandbox size is not an `AgentAction`.** `AgentAction` is ACP (`prompt`, `set_model`, `compact`, `stop`). Size is harness/container policy. Do not send it to the agent. Use a dedicated settings endpoint for the user default, and a field on the session response for the size this session was spawned with.
7. **Every authenticated user may pick any tier.** No plan gating, no locks, no team-admin override, no extra receipts. `GET`/`PUT` the caller's own default; mention spawn already knows the sender. Handlers do not branch on who may use `large`.
8. **Policy lives in the harness domain; resize capability lives on the container-manager port.** Inbound parses the tier. Domain validates the name, resolves the user default, and puts it on `SpawnContainer`. Named size → CPU/RAM/disk is harness mapping. Whether an existing container can take that change (`NoOp` / `InPlace` / `Restart` / `Unsupported`) is `ContainerManager::resize_effect`. Domain closes/resumes from that effect and calls `resize(session, size)` with no kind argument. Adapters implement the effect and the resize. Hexagonal boundary: no Daytona/Namespace types in domain, no size policy in axum handlers or the web picker.

## Goals

- Every new Macro Coder sandbox is 8 vCPU / 16 GiB / 96 GiB unless the user picked `small` or `large`.
- `GET` session includes `sandboxSize`.
- A user can set their default size; the next `@coder` mention uses it.
- Unknown or raw resource payloads are rejected at the API boundary.
- Daytona and Namespace both honor the same three tiers.
- Existing sessions keep working: a NULL/missing size on old rows means `default` at the new resource mapping only for *new* spawns. Already-running sandboxes stay at whatever Daytona already gave them.

## Non-goals (v1)

- Recreating a sandbox to change size (Daytona CPU/RAM resize in place instead).
- Per-team or per-org size caps, plan gating, or paywalled `large`.
- Extra authorization beyond "the caller sets their own default."
- Billing, metering, or showing remaining Daytona quota in the UI.
- GPU tiers.
- Letting external (non-managed) agent runtimes declare a size. They bring their own machine.
- Putting a size picker in the `@` mention typeahead.
- Recreating a live sandbox when the user changes their default.

## Resource mapping

Units match Daytona: CPU cores, memory GiB, disk GiB.

| Tier      | vCPU | RAM | Disk | Notes                                      |
| --------- | ---- | --- | ---- | ------------------------------------------ |
| `small`   | 2    | 4   | 96   | Cheap / short tasks                        |
| `default` | 8    | 16  | 96   | The new Macro Coder size                   |
| `large`   | 16   | 32  | 96   | Same disk so live sessions can hot-resize  |

Namespace create gets the same tier, mapped onto its shape (`virtual_cpu`, `memory_megabytes` = RAM GiB × 1024). It has no disk field today, so disk is Daytona-only until Namespace exposes one.

If the live Daytona quota cannot place `large`, ship `small` + `default` only and keep `Large` out of the public enum until it can.

## Product behavior

### New `@coder` mention

1. Trigger pipeline opens a managed session as it does today.
2. Harness loads the sender's default `SandboxSize`, or `Default`.
3. Session row is created with that size.
4. `spawn` passes the size to the container manager.
5. Daytona create omits resource fields. After the sandbox starts, spawn resizes CPU/RAM to the session tier (in-place if the snapshot is smaller, restart if it is larger). Disk stays at the snapshot's disk.

### User default

- Stored server-side in `user_agent_sandbox_size`, not in `localStorage` — mention spawn is backend-only and would ignore a browser preference.
- Any signed-in user can read and write **their own** row. All three sizes are available. No extra authz layer.
- New endpoint, not `POST /agent-sessions` (that route still rejects managed bots) and not `/control` (that route is ACP).
- Suggested shape:
  - `GET /agent-sandbox-size` → `{ size: "small" | "default" | "large" }`
  - `PUT /agent-sandbox-size` `{ size }` → same
- First-time users have no row; reads return `default`.

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

Port: `AgentSandboxSizePreference` with `get(user) -> SandboxSize` and `set(user, size)`. Missing row → `Default`. The authenticated user is the `user_id`; do not add role checks, receipts, or per-tier permission.

### Authorization

None beyond the existing session view extractor and "this is my user id." Every user can pick `small`, `default`, or `large`. Spawn uses the observed mention sender; it must not take a size from the message body.

## Provider mapping

### Daytona

`CreateSandboxRequest` gains:

```rust
cpu: u32,
memory: u32, // GiB
disk: u32,   // GiB
```

`configuration_parameters` sends `snapshot`, `env`, `labels`, and `auto_stop_interval: 0` only. Daytona rejects `cpu` / `memory` / `disk` on snapshot creates (HTTP 400: "Cannot specify Sandbox resources when using a snapshot"). Size is applied after start via `POST /sandbox/{id}/resize` with `cpu` and `memory` only.

Snapshot create in `justfile` / `ensure-daytona` is `--cpu 8 --memory 16 --disk 96` so a `default` spawn is a no-op after create, `large` is an in-place resize, and `small` is a restart resize. Rebuild the snapshot (delete + create); `snapshot create` will not replace an existing name.

Verify with a throwaway sandbox: create from the snapshot with no resource fields, wait until started, stay inside the org per-sandbox cap, shrink while stopped, then raise CPU/RAM in place without sending `disk`, and confirm disk is unchanged. Always delete the sandbox.

### Namespace

Same idea as Daytona: create-time resources from the tier, not a hardcoded shape.

Replace

```rust
virtual_cpu: 2,
memory_megabytes: 4096,
```

with the mapped `virtual_cpu` and `memory_megabytes` for `SpawnContainer.size`. Namespace's `ShapeRequest` has no disk field, so do not invent one. If Namespace adds disk later, thread `disk_gib` through the same mapping.

### coding-agent-worker

Out of scope unless it is still used to boot Macro Coder. Production harness is `crates/agent_harness`. Do not silently fork a second size table there.

## API / SDK

- `AgentSessionResponse.sandboxSize`: `"small" | "default" | "large"`.
- New user-default routes on the agent harness service (same service that already owns managed sessions).
- OpenAPI in `agent_session` / `agent_harness_service` swagger, then `just coverage` / add-sdk-endpoint skill so `packages/sdk` and the web generated client pick it up.
- Do **not** add `sandboxSize` to `CreateAgentSessionRequest` in v1. That route is for external runtimes and rejects managed bots. Mention spawn is not that route.

## UI

Small composer control, same family as Macro AI's `ModelSelector` — not a header setting, not in the `@` mention typeahead.

`AgentInput` today is a `Surface` with the editor and a send/stop button in the bottom-right. Add a ghost `Dropdown` to the left of send, mirroring `ChatInput`'s right-controls cluster.

### Closed

```
┌──────────────────────────────────────────────────────┐
│  Message the agent                                   │
│                           [Default ▾]  (send)        │
└──────────────────────────────────────────────────────┘
```

Trigger: `Dropdown.Trigger` `variant="ghost"` `size="sm"`, `text-xs`, caret, no CPU icon required. Label is the **user default** (`Small` / `Default` / `Large`), not raw resources.

When the editor wraps past one line, the chip stays bottom-right with send, same as ChatInput.

### Open

```
                              ┌──────────────────────────┐
                              │ Small                    │
                              │ 2 vCPU · 4 GB · 20 GB    │
                              │ ✓ Default                │
                              │ 8 vCPU · 16 GB · 96 GB   │
                              │ Large                    │
                              │ 16 vCPU · 32 GB · 200 GB │
                              │                          │
                              │ Applies to new @coder    │
                              │ sessions                 │
                              └──────────────────────────┘
┌──────────────────────────────────────────────────────┐
│  Message the agent                                   │
│                           [Default ▾]  (send)        │
└──────────────────────────────────────────────────────┘
```

All three rows are always enabled. No lock icons, no paywall, no "unavailable." Checkmark on the current user default.

Footer copy is required: picking a size does not resize the open sandbox. `PUT /agent-sandbox-size`, toast on success ("New @coder sessions will use Large").

If this session's snapshotted size differs from the user default, the trigger can stay as the default (what you will get next) rather than the current session. Optional muted line under the footer: `This session: Default`. Skip that if it feels noisy; the session response still has `sandboxSize` for later.

### Component split

- `apps/web/src/features/block-agent/ui/SandboxSizeSelector.tsx` — pure: `size`, `onSelect`, options hardcoded. Reuse `@ui` `Dropdown` like `ModelSelector`.
- `AgentInput` grows an optional `size` / `onSizeSelect` slot in the right-controls cluster. Keep the ui/ component free of queries.
- `AgentComposer` loads `GET /agent-sandbox-size` (fallback `default`) and `PUT`s on select.

No picker on `AgentSplitHeader`. No mention-typeahead control.

## Phasing

### 1. Default size bump (can ship alone)

- Snapshot flags → 8 / 16 / 96.
- Daytona create omits `cpu`/`memory`/`disk`.
- Tests: Daytona create JSON omits resource fields; resize omits `disk`; snapshot justfile comment about the 10GB ceiling is removed.
- No UI. Every new sandbox is `default`.

### 2. Domain + persistence + API

- `SandboxSize` enum, `SpawnContainer.size`, session column, user-default table.
- Mention `open` reads the user default.
- `GET`/`PUT /agent-sandbox-size`, session response field.
- Domain tests: missing preference → `Default`; `PUT` then mention uses the new size; unknown size → 422; outbound mapping for all three tiers on both providers.

### 3. UI picker

- `SandboxSizeSelector` on `AgentInput`, wired from `AgentComposer`.
- Generated client from phase 2.
- Footer copy + toast that this session does not resize.

### 4. Later (not this plan)

- Daytona `resize` for CPU/RAM on a live session (disk grow-only).
- Team default.
- "Restart this session at a new size" (teardown + new sandbox; loses the live workspace unless we snapshot first).

## Testing

- `cargo test -p agent_harness` for spawn mapping, preference fallback, and Daytona request body.
- `cargo test -p agent_session` for the new column on create/get fixtures.
- SQLX: `just prepare_db` after the migration, from the repo root, with `SQLX_OFFLINE` unset.
- Web: `SandboxSizeSelector` test that every tier is enabled; composer test that select calls `PUT` and does not call session `/control`.
- Manual: one real Daytona create per tier against the quota (phase 1 spike for override; phase 2 for `small` vs `default`).

## Risks

- **Snapshot create rejects resource fields (HTTP 400).** Mitigated by inheriting snapshot quotas on create and applying the named tier with resize.
- **`POST /sandbox/{id}/resize` 404s with `Cannot POST` when the route is not registered on this API.** Daytona documents resize as available to all organizations. The client maps that 404 to `ResizeNotEnabled`. A missing sandbox 404s with "not found" instead.
- **Live per-sandbox cap is 4 vCPU / 8 GiB / 10 GiB.** `POST /snapshots` with `--cpu 8 --memory 16 --disk 96` returns 400: "CPU request 8 exceeds maximum allowed per sandbox (4)". Ask Daytona to raise per-sandbox limits to at least 16 / 32 / 96 (`large`) before rebuilding `macro-agent-harness`. Do not delete the live 4/8/10 snapshot until that create would succeed.
- **`large` exceeds quota.** Keep it out of the public enum until a create succeeds.
- **Users think the picker resizes the open session.** Header copy + toast. Size on the session response is the spawned size, not the pending default.
- **Mention already spawned before the UI is visible.** That is why the picker edits the *next* session's default, not the current sandbox.
- **Namespace disk.** Document that `small`/`large` on Namespace only change CPU/RAM.

## Files (expected)

- `crates/agent_harness/justfile` — snapshot resources
- `crates/agent_harness/src/domain/ports.rs` — `ContainerManager::resize_effect` + `resize` without a kind argument
- `crates/agent_harness/src/domain/sandbox.rs` — named size → CPU/RAM/disk; in-place vs restart comparison
- `crates/agent_harness/src/domain/service.rs` — resolve user default on `open`
- `crates/agent_harness/src/outbound/daytona/client.rs` — create omits resources; resize sends `cpu`/`memory`
- `crates/agent_harness/src/outbound/namespace/client.rs` — shape from tier
- `crates/agent_session/src/domain/model.rs` + postgres outbound — `sandbox_size` column
- `crates/macro_db_client/migrations/` — session column + `user_agent_sandbox_size`
- `crates/agent_session/src/inbound/axum_router.rs` — response field; new default-size handlers (or a small harness inbound module)
- `apps/web/src/features/block-agent/ui/SandboxSizeSelector.tsx` — dropdown
- `apps/web/src/features/block-agent/ui/AgentInput.tsx` — right-controls slot next to send
- `apps/web/src/features/block-agent/component/AgentComposer.tsx` — GET/PUT default size
- Generated OpenAPI / SDK clients after the new routes

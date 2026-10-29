---
name: upgrade-model
description: Upgrade an AI chat model or its default selection across backend and frontend.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---

# Upgrade a chat model

Confirm the provider-qualified model ID and which callers should change: a
selectable chat model, the paid/free default, or the internal Smart/Fast tier.
These are separate choices; the application no longer has a two-entry
`CHAT_MODELS` array in the cognition service.

## Model definitions and routing

- `crates/agent/src/model/types.rs` accepts `provider/model` IDs. Routing in
  `crates/agent/src/model/router.rs` selects the provider from that prefix.
- `crates/agent/src/model/predefined_model.rs` defines the serialize-only
  `PredefinedModel` convenience enum and internal Smart/Fast defaults. Update its
  serialization, conversion, context window, and thinking parameters when the
  requested change affects one of those predefined models.
- Check provider-specific behavior and speed support in `crates/agent/src/model/`
  before assigning a new model the capabilities of its predecessor.
- `crates/chat/src/domain/models/model_access.rs` owns the selectable chat
  `CHAT_MODELS`, `PAID_DEFAULT_MODEL`, and `FREE_MODEL`. Change the relevant
  catalog/default and preserve the intended plan restrictions.

The harness chat handler in
`services/agent_harness_service/src/cognition/api/stream/chat_message.rs`
validates and forwards `request.model`; it does not select an enum variant.
There is no cognition `core/model.rs` or `api/ws/chat_message/mod.rs` to update.

## Frontend and persisted selections

Update `apps/web/src/lib/core/component/AI/constant/model.ts`: the ID catalog,
pretty names, provider icons, and relevant paid/free/database defaults. Search
for the retired ID in callers and tests rather than assuming a particular input
component contains it. Keep the frontend catalog aligned with the backend.

Check the pricing setup under `crates/ai_billing` and MacroDB pricing migrations;
a new provider ID needs the corresponding pricing configuration.

When retiring a model, migrate saved selections as well. Routines
(`scheduled_action.task->>'model'`) and in-memory agents
(`agent_configs.default_model`) persist their model. Follow
`crates/macro_db_client/migrations/20261019221542_upgrade_retired_claude_models.sql`,
keep the Macro-runtime scope, and bump the routine's `configuration_revision`.
Create migrations through the `sqlx-migration` skill.

## Validation

Run the affected `agent`, `chat`, and `agent_harness_service` tests, then the
`rust-validation` skill. Run `bun run check` and the affected model-selector tests
in `apps/web`.

If model schemas changed (including `FreeTierModel`), regenerate the frontend
with `bun run gen-api` in `apps/web` and verify `bun run gen-api -- --check`.
Regenerate SDK artifacts when their API specifications change. Resolve all new
failures before handing off; report unrelated existing failures explicitly.

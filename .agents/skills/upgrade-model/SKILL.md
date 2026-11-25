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

When retiring a model, map it to its replacement in `RETIRED_MODELS`
(`model_access.rs`) and in the web's `RETIRED_MODELS` (`model.ts`). The backend
upgrades retired ids when a session opens, resumes or changes model, and when a
chat message, structured completion or database question arrives; the web
upgrades saved chats, drafts and the remembered agent model, and shows a Macro
agent, session or routine saved on a retired id as its replacement
(`currentModelId`).
Saved selections keep the retired id: routines (`scheduled_action.task`, both a
legacy task's `model` and each agent step's `model` under `steps`) and in-memory
agents (`agent_configs.default_model`) are read through the mapping, so keep a
mapping row for as long as saved rows can name its id. Don't rewrite them in a
migration: the tables grow with use, migrations run before code that knows the
new id deploys, and raising a routine's `configuration_revision` supersedes its
queued event runs. A rewrite is a batched job that leaves the revision alone.

## Validation

Run the affected `agent`, `chat`, and `agent_harness_service` tests, then the
`rust-validation` skill. Run `bun run check` and the affected model-selector tests
in `apps/web`.

If model schemas changed (including `FreeTierModel`), regenerate the frontend
with `bun run gen-api` in `apps/web` and verify `bun run gen-api -- --check`.
Regenerate SDK artifacts when their API specifications change. Resolve all new
failures before handing off; report unrelated existing failures explicitly.

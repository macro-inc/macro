---
name: upgrade-model
description: Upgrade an AI chat model (fast or good) across backend and frontend.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---

# Upgrade Chat Model

Upgrades the AI model used in the chat app. There are two model slots:
- **fast** (Enter): default/fallback model (first entry in `CHAT_MODELS`)
- **good** (Cmd+Enter): smart mode model (second entry in `CHAT_MODELS`)

The user must specify which slot to upgrade and the new model name (e.g. `claude-opus-4-6`).

## Steps

### 1. Determine the change

Ask the user (if not already provided):
- Which slot: `fast` or `good`?
- What is the new model name? (e.g. `claude-opus-4-6`)

Derive from the model name:
- `SERDE_NAME`: the kebab-case model ID sent over the wire (e.g. `claude-opus-4-6`)
- `ENUM_VARIANT`: PascalCase variant name (e.g. `Claude46Opus`)
- `CONST_NAME`: SCREAMING_SNAKE constant name (e.g. `CLAUDE_46_OPUS`)
- `CONST_VALUE`: display string used by the frontend/provider (e.g. `claude-4.6-opus`)
- `PRETTY_NAME`: human-readable name (e.g. `Claude Opus 4.6`)

### 2. Add model to AI crate (if it doesn't already exist)

File: `rust/cloud-storage/ai/src/types/model/mod.rs`

Check if the enum variant already exists. If not, add all of the following:

1. **Enum variant** in `pub enum Model` (under the Anthropic section):
   ```rust
   #[serde(rename = "{SERDE_NAME}")]
   #[strum(serialize = "{SERDE_NAME}")]
   {ENUM_VARIANT},
   ```

2. **String constant** in `pub mod constants::models`:
   ```rust
   pub const {CONST_NAME}: &str = "{CONST_VALUE}";
   ```

3. **Match arm** in `to_provider_model_string()`:
   ```rust
   Model::{ENUM_VARIANT} => (ANTHROPIC, {CONST_NAME}),
   ```

4. **Match arm** in `from_model_str()`:
   ```rust
   {CONST_NAME} => Model::{ENUM_VARIANT},
   ```

File: `rust/cloud-storage/ai/src/types/model/metadata.rs`

5. **Metadata** in `fn metadata()`:
   ```rust
   Model::{ENUM_VARIANT} => ModelMetadata {
       context_window: 200_000,
   },
   ```
   Use the correct context window for the model. Anthropic models are typically 200,000.

6. **Provider** in `fn provider()`:
   ```rust
   Model::{ENUM_VARIANT} => Provider::Anthropic,
   ```

### 3. Update DCS constants

File: `rust/cloud-storage/document_cognition_service/src/core/model.rs`

- If upgrading the **fast** slot: change the first entry in `CHAT_MODELS` and update `FALLBACK_MODEL`.
- If upgrading the **good** slot: change the second entry in `CHAT_MODELS`.

### 4. Update DCS chat message handler

File: `rust/cloud-storage/document_cognition_service/src/api/ws/chat_message/mod.rs`

Search for the old model variant being used in the model selection logic (e.g. `Model::Claude45Opus`). Update it to the new variant.

### 5. Verify Rust compiles

```bash
cd rust/cloud-storage && cargo check -p ai -p document_cognition_service
```

Fix any compilation errors before proceeding.

### 6. Generate frontend types

Run from `js/app/`:
```bash
cd js/app && bun install && bun run gen-api
```

This builds all Rust OpenAPI and models binaries from local code, generates `openapi.json`, runs orval for TypeScript types, and generates `model.ts` from the local models binary. All generated files will reflect your local Rust changes.

### 7. Run `bun check` to find frontend usages

```bash
cd js/app && bun check
```

This will report TypeScript errors everywhere the old model string is used. Fix each one. Common locations:

- `packages/core/component/AI/constant/model.ts` — `MODEL_PRETTYNAME`, `MODEL_PROVIDER_ICON`, `SMART_MODE_MODEL` / `DEFAULT_MODEL`
- `packages/core/component/AI/component/input/useChatInput.tsx` — hardcoded model references
- `packages/core/component/AI/signal/pendingSend.test.ts` — test data

Replace old model strings and update display names.

### 8. Format and verify

```bash
cd js/app && bun format && bun check
```

The only errors remaining should be **pre-existing** ones unrelated to models (e.g. `three`, `@aws-crypto/sha256-js` type issues). All model-related errors must be resolved.

Finally, run the CI check:
```bash
cd js/app && bun run gen-api -- --check
```

This must pass.

## Notes

- We only support Anthropic models for chat. Other providers exist in the AI crate but are not used for the chat feature.
- The `ExhaustiveMap` type in `constant/model.ts` requires an entry for every model in the `Model` type, so missing entries will cause type errors.
- The `SMART_MODE_MODEL` constant is the "good" model, `DEFAULT_MODEL` is the "fast" model.

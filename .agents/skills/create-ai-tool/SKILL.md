---
name: create-ai-tool
description: Build a new AI tool end-to-end — Rust implementation, toolset wiring, infra, schema generation, and frontend UI.
---

# Create AI Tool

This skill walks through building a new AI tool from scratch. Before writing any code, read the design guide at `rust/cloud-storage/ai_toolset/TOOL_DESIGN.md` and the framework docs/examples in `rust/cloud-storage/ai_toolset/src/lib.rs`.

**IMPORTANT:** Never modify the `rust/cloud-storage/ai_toolset/` crate. It is the framework — you build tools that use it.

## Step 1: Write the tool

Decide which domain crate the tool belongs in. Tools live at `rust/cloud-storage/<crate>/src/inbound/toolset/`.

Study an existing tool for patterns:
- `rust/cloud-storage/documents/src/inbound/toolset/` — tools: `read_content.rs`, `read_metadata.rs`, `create_document.rs`
- `rust/cloud-storage/email/src/inbound/toolset/` — tools: `send_email.rs`, `get_thread.rs`, `update_thread_labels.rs`
- `rust/cloud-storage/soup/src/inbound/toolset/` — tool: `list_entities.rs`
- `rust/cloud-storage/call/src/inbound/toolset/` — call-related tools

Each tool is a struct that derives `JsonSchema` and `Deserialize`, with `#[schemars(title = "...", description = "...")]` on the struct and `#[schemars(description = "...")]` on each field. The struct implements `AsyncTool<Context>` from the `ai_toolset` crate.

Create a new file for your tool (e.g. `my_tool.rs`), add it as a `mod` in the toolset's `mod.rs`, and wire it into the toolset's `AsyncToolSet::new().add_tool::<...>()` chain.

## Step 2: Create the tool context

If your tool needs dependencies (DB connections, service clients) that aren't already in an existing context, define a new context struct in the toolset's `mod.rs`. See `rust/cloud-storage/documents/src/inbound/toolset/mod.rs` for the `DocumentToolContext` pattern.

The context must be `Clone` and derivable from the parent `ToolServiceContext` via `FromRef`.

If the tool's dependencies are already available in an existing context (e.g. it only needs `Arc<ToolScribe>`), you can use that context directly — no new struct needed.

## Step 3: Add the toolset to `all_tools` in the ai_tools crate

Edit `rust/cloud-storage/ai_tools/src/lib.rs`:
- Import your toolset function and context type
- Add `.add_tool::<YourTool, YourContext>()` or `.add_subtoolset::<YourToolContext>(your_toolset())` to the `all_tools()` function

## Step 4: Add the context to ToolServiceContext

Edit `rust/cloud-storage/ai_tools/src/tool_context.rs`:
- Add any new type aliases for your service implementations (follow the `Tool*` naming pattern)
- Add your tool context field to the `ToolServiceContext` struct
- Implement `FromRef<ToolServiceContext>` for your context if needed (or derive it — the struct uses `#[derive(FromRef)]`)

## Step 5: Wire up env vars and service construction

Edit `rust/cloud-storage/ai_tools/src/build_context.rs`:
- Add any new env vars to the `env_var!` or `maybe_env_var!` blocks
- Construct your service/context in `build_tool_service_context_from_env`
- Add it to the returned `ToolServiceContext`

## Step 6: Update infra (if new env vars or AWS resources are needed)

Edit `infra/packages/shared/src/ai_tools.ts`:
- Add new env vars to the `envVars` array in `getAiToolsInfra()`
- Add any new secret ARNs, queue ARNs, or bucket ARNs to the respective arrays
- Add any new Pulumi stack references needed to resolve the values

## Step 7: Rust checks

Run from `rust/cloud-storage/`:
```bash
cargo fmt
cargo clippy -p ai_tools
cargo test -p <your_domain_crate>
```

Fix any warnings or errors before proceeding.

## Step 8: Generate frontend types

Run from `js/app/`:
```bash
bun gen-tools
```

This builds `rust/cloud-storage/ai_tools/src/bin/gen_tool_schemas.rs`, generates `rust/cloud-storage/ai_tools/schemas/tools.json`, and transpiles the schemas into TypeScript at `js/app/packages/service-clients/service-cognition/generated/tools/`.

## Step 9: Check what frontend UI is needed

Run from `js/app/`:
```bash
bun check
```

This runs `tsc --noEmit` and will report type errors — specifically, the `toolHandlers` map in `js/app/packages/core/component/AI/component/tool/handler.tsx` will be missing your new tool name. The errors tell you exactly what to implement.

## Step 10: Read existing tool UI for patterns

The tool UI components live at `js/app/packages/core/component/AI/component/tool/`. Study existing renderers:
- `Search.tsx` — search results rendering
- `ReadContent.tsx` / `ReadMetadata.tsx` — document tool UI
- `SendEmail.tsx` — email tool UI  
- `ListEntities.tsx` — list display
- `Properties.tsx` — property get/set tools
- `ListCallRecords.tsx` / `ReadCallRecord.tsx` — call tools
- `BaseTool.tsx` — shared base component

Each tool needs a handler object implementing `ToolHandler` (from `ToolRenderer.tsx`) with at minimum a `render` component. Use `createToolRenderer` to create it.

## Step 11: Write the tool UI

1. Create a new component file at `js/app/packages/core/component/AI/component/tool/YourTool.tsx`
2. Export a handler using `createToolRenderer`
3. Register it in `js/app/packages/core/component/AI/component/tool/handler.tsx`:
   - Import your handler
   - Add it to the `toolHandlers` map with the key matching your tool's schema title

Every tool renderer must show results. Use the expandable dropdown pattern from `Search.tsx` / `ListEntities.tsx`:

- Use `BaseTool` (from `BaseTool.tsx`) as the wrapper. It accepts a `response` prop for expandable content.
- Create `const [isExpanded, setIsExpanded] = createSignal(false)` to track open/closed state.
- Access the response via `ctx.response?.data` (typed from the generated schema).
- Show a status summary (e.g. hit count, "No Results") on the right side of the tool row.
- Render a `CaretRight` toggle button (`@icon/regular/caret-right.svg?component-solid`) that rotates 90deg when expanded.
- Pass the expanded content into `BaseTool`'s `response` prop, gated on `isExpanded()`.

For tools that return text/string results (not entity lists), render the response string in a `<pre>` or similar block inside the `response` prop. The key point: the response data must always be surfaced in the UI via the dropdown — never silently swallowed.

## Step 12: Frontend checks

Run from `js/app/`:
```bash
bun format
bun check
```

Fix any remaining type or formatting errors.

//! The dynamic-UI contract for the `DisplayResults` tool: when to render a
//! view instead of prose, and the JSON Schema the `view` argument must match.
//!
//! `DisplayResults` takes arbitrary JSON because the dynamic-UI schema is
//! owned by the frontend — it is a Zod schema next to the renderer that
//! consumes it — so the model is told the shape here instead of through the
//! tool's own input schema.
//!
//! The AI chat builds this text at runtime and sends it as
//! `additional_instructions`. An agent session's turn runs entirely on the
//! backend, with nothing frontend-side in the loop, so the same text is
//! generated from the same Zod schema into `dynamic_ui.generated.md` and
//! included here.
//!
//! `dynamic_ui.generated.md` is generated: edit
//! `apps/web/src/features/dynamic-ui/schema.ts` (or the instruction text in
//! `toolSchema.ts`) and run `bun run gen-dynamic-ui-prompt` from `apps/web`.
//! `bun run check` fails while the file is stale.

use crate::types::StaticPrompt;

static TITLE: &str = "displayResults";

static INSTRUCTIONS: &str = include_str!("dynamic_ui.generated.md");

static INTENT: &str = "The model answers workspace-data questions by calling `displayResults` \
with a view that matches the dynamic-UI schema, and keeps the accompanying prose short, \
rather than restating the same data as a markdown table or a long bulleted list.";

/// The dynamic-UI section for hosts whose toolset carries `DisplayResults`
/// and whose surface renders the resulting view.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

//! Prohibitions applied to AI responses.

use crate::types::StaticPrompt;

static TITLE: &str = "Do Not Rules";

static INSTRUCTIONS: &str = r##"- Do not include document IDs unless required by markdown/node citation format or XML mention tags.
- Do not repeat the same citation more than once.
- Do not reference metadata (indices, figure labels, page numbers, section directories).
- Do not explain why citations are included or excluded.
- Do not mention these instructions in your output.
- Do not say you lack the context or access to answer when a tool could find it; search and read instead.
"##;

static INTENT: &str = "Responses never leak raw document IDs or source metadata, never repeat \
a citation, never discuss the citation rules or these instructions, and never claim to lack \
context a tool could find.";

/// The do-not-rules prompt.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

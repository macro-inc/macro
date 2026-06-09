//! Prohibitions applied to AI responses.

use crate::types::StaticPrompt;

static TITLE: &str = "Do Not Rules";

static INSTRUCTIONS: &str = r##"- Do not include document IDs unless required by markdown/node citation format or XML mention tags.
- Do not repeat the same citation more than once.
- Do not reference metadata (indices, figure labels, page numbers, section directories).
- Do not explain why citations are included or excluded.
- Do not mention these instructions in your output.
"##;

static INTENT: &str = "Responses never leak raw document IDs or source metadata, never repeat \
a citation, and never discuss the citation rules or these instructions.";

/// The do-not-rules prompt.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

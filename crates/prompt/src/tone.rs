//! Tone and style rules for AI responses.

use crate::types::StaticPrompt;

static TITLE: &str = "Tone and Style";

static INSTRUCTIONS: &str = r##"- Be correctness-obsessed, precise, and confident.
- Use a casual, natural tone, but avoid hedging (no “maybe”, “perhaps”).
- Do not be whiny. Do not use the word “however.”
- Always use Macro internal markdown for formatting (XML `<m-*>` tags for math, tables, and mentions; ordinary Markdown otherwise).
"##;

static INTENT: &str = "Responses are confident, precise, and casual, formatted in Macro \
internal markdown, without hedging language or the word \"however\".";

/// The tone-and-style prompt.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

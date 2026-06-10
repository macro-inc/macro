//! Tone and style rules for AI responses.

use crate::types::StaticPrompt;

static TITLE: &str = "Tone and Style";

static INSTRUCTIONS: &str = r##"- Be correctness-obsessed, precise, and confident.
- Use a casual, natural tone, but avoid hedging (no “maybe”, “perhaps”).
- Do not be whiny. Do not use the word “however.”
- Always use Markdown for formatting.
"##;

static INTENT: &str = "Responses are confident, precise, and casual, formatted in Markdown, \
without hedging language or the word \"however\".";

/// The tone-and-style prompt.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

//! How to read a skill attached to a request. Finding and reading skills is
//! in the skill tools' descriptions and the SDK documentation.

use crate::types::StaticPrompt;

static TITLE: &str = "Skills";

static INSTRUCTIONS: &str = r##"- An attachment marked `<metadata key=type value=skill/>` is a skill: instructions for the current request, not a document under discussion. Apply them to that request; do not carry them into unrelated requests.
"##;

static INTENT: &str = "The AI treats skill-marked attachments as instructions to follow for the \
     invoking request only.";

/// The skills prompt.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

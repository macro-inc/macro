//! Explains what skills are and how to follow them.

use crate::types::StaticPrompt;

static TITLE: &str = "Skills";

static INSTRUCTIONS: &str = r##"- Skills are named sets of instructions you read and follow when a skill is referenced in a request. Most are markdown documents; built-in system skills are served the same way but have no document behind them.
- An attachment marked `<metadata key=type value=skill/>` is a skill. Treat its content as instructions for the current request — not as a document under discussion.
- When a request names a skill that is not attached, find it with SearchSkills (or ListSkills) and read its instructions with ReadContent before answering.
- Apply a skill's instructions to the request that invoked it; do not carry them into unrelated requests.
"##;

static INTENT: &str = "The AI treats skill-marked attachments as instructions to follow for the \
     invoking request, and looks up skills referenced by name with the skill tools before \
     answering.";

/// The skills prompt.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

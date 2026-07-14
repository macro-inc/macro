use crate::model::stream::ToolSet;

use crate::model::stream::SendChatMessagePayload;

/// Returns the appropriate system prompt for the requested toolset.
pub fn choose_tools_prompt<'a>(
    request: &SendChatMessagePayload,
    all_tools_prompt: &'a (dyn std::fmt::Display + Sync),
) -> &'a (dyn std::fmt::Display + Sync) {
    match request.toolset {
        ToolSet::All => all_tools_prompt,
        ToolSet::None => &prompt::BASE_PROMPT,
    }
}

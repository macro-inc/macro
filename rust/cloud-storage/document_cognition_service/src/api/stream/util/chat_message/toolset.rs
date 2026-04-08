use crate::model::stream::ToolSet;

use crate::model::stream::SendChatMessagePayload;

/// Returns the appropriate system prompt for the requested toolset.
pub fn choose_tools_prompt(
    request: &SendChatMessagePayload,
    all_tools_prompt: &'static str,
) -> &'static str {
    match request.toolset {
        ToolSet::All => all_tools_prompt,
        ToolSet::None => ai_tools::prompts::BASE_PROMPT,
    }
}

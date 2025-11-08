use crate::model::ws::ToolSet;
use ai_tools::{ToolSetWithPrompt, all_tools, no_tools};

use crate::model::ws::SendChatMessagePayload;

pub fn choose_toolset(request: &SendChatMessagePayload) -> ToolSetWithPrompt {
    match request.toolset {
        ToolSet::All => all_tools(),
        ToolSet::None => no_tools(),
    }
}

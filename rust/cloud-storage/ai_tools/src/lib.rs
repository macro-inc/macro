use ai::tool::AsyncToolSet;
pub mod list;
pub mod prompts;
pub mod read;
pub mod rewrite;
pub mod search;
mod tool_context;

pub use search::search_toolset;
pub use tool_context::*;

use crate::list::list_toolset;

pub type AiToolSet = AsyncToolSet<ToolServiceContext, RequestContext>;

pub struct ToolSetWithPrompt {
    pub toolset: AiToolSet,
    pub prompt: &'static str,
}

pub fn all_tools() -> ToolSetWithPrompt {
    let toolset = AsyncToolSet::new()
        .add_toolset(search_toolset())
        .expect("failed to add search toolset")
        .add_toolset(list_toolset())
        .expect("failed to add list toolset")
        .add_tool::<read::Read>()
        .expect("read tool")
        .add_tool::<rewrite::MarkdownRewrite>()
        .expect("markdown revision tool");
    let prompt = prompts::TOOLS_PROMPT;
    ToolSetWithPrompt { toolset, prompt }
}

pub fn no_tools() -> ToolSetWithPrompt {
    ToolSetWithPrompt {
        prompt: prompts::BASE_PROMPT,
        toolset: AsyncToolSet::new(),
    }
}

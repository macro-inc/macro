use ai_toolset::AsyncToolSet;
use ai_toolset::schema::{ToolSchemaGenerator, ToolSchemas};
pub mod code_execution;
pub mod prompts;
pub mod read;
#[allow(dead_code)]
mod rewrite;
pub mod search;
mod tool_context;
pub mod web_fetch;
use code_execution::{
    anthropic_bash_code_execution_tool, anthropic_text_editor_code_execution_tool,
};
use search::web::anthropic_web_search::anthropic_web_search_tool;
use soup::inbound::toolset::{ListEntities, SoupToolContext};
use std::sync::Arc;
use web_fetch::anthropic_web_fetch_tool;

pub use search::search_toolset;
pub use tool_context::*;

pub type AiToolSet = AsyncToolSet<ToolServiceContext>;

pub struct ToolSetWithPrompt {
    pub toolset: AiToolSet,
    pub prompt: &'static str,
}

impl ToolSchemaGenerator for ToolSetWithPrompt {
    fn generate_schemas(&self) -> ai_toolset::schema::ToolSchemas {
        self.toolset.generate_schemas()
    }
}

/// These are actually sent to the AI provider
pub fn all_tools() -> ToolSetWithPrompt {
    let toolset = AsyncToolSet::new()
        .add_toolset(search_toolset())
        .expect("failed to add search toolset")
        // .add_toolset(list_toolset())
        // .expect("failed to add list toolset")
        .add_tool::<ListEntities, SoupToolContext<ToolSoupService>>()
        .expect("failed to add list entities tool")
        .add_tool::<read::Read, Arc<ToolScribe>>()
        .expect("read tool");
    let prompt = prompts::TOOLS_PROMPT;
    ToolSetWithPrompt { toolset, prompt }
}

/// These are used to generate schemas for the frontend
/// See [ai_toolset::schema::PhantomTool]
pub fn all_tool_schemas() -> ToolSchemas {
    all_tools()
        .merge(&*anthropic_web_search_tool)
        .merge(&*anthropic_web_fetch_tool)
        .merge(&*anthropic_bash_code_execution_tool)
        .merge(&*anthropic_text_editor_code_execution_tool)
        .generate_schemas()
}

pub fn no_tools() -> ToolSetWithPrompt {
    ToolSetWithPrompt {
        prompt: prompts::BASE_PROMPT,
        toolset: AsyncToolSet::new(),
    }
}

#![recursion_limit = "256"]

use ai_toolset::AsyncToolSet;
use ai_toolset::schema::{ToolSchemaGenerator, ToolSchemas};
mod build_context;
pub mod code_execution;
pub mod prompts;
pub mod read;
#[allow(dead_code)]
mod rewrite;
pub mod search;
pub mod serde_utils;
mod subagent;
mod tool_context;
pub mod web_fetch;
use call::inbound::toolset::call_toolset;
use code_execution::{
    anthropic_bash_code_execution_tool, anthropic_text_editor_code_execution_tool,
};
use documents::inbound::toolset::document_toolset;
use email::inbound::toolset::email_toolset;
use properties::inbound::toolset::properties_toolset;
use search::web::anthropic_web_search::anthropic_web_search_tool;
use soup::inbound::toolset::{ListEntities, SoupToolContext};
use std::sync::Arc;
use subagent::Subagent;
use web_fetch::anthropic_web_fetch_tool;

pub use build_context::build_tool_service_context_from_env;
pub use search::search_toolset;
pub use tool_context::*;

pub type AiToolSet = AsyncToolSet<ToolServiceContext>;

pub struct ToolSetWithPrompt {
    pub toolset: Arc<AiToolSet>,
    pub prompt: &'static str,
}

impl ToolSchemaGenerator for ToolSetWithPrompt {
    fn generate_schemas(&self) -> ai_toolset::schema::ToolSchemas {
        self.toolset.generate_schemas()
    }
}

/// Toolset available to subagents — everything except email and the Subagent
/// tool itself (subagents cannot create subagents).
pub(crate) fn subagent_toolset() -> AiToolSet {
    AsyncToolSet::new()
        .add_toolset(search_toolset())
        .add_tool::<ListEntities, SoupToolContext<ToolSoupService, ToolEmailService>>()
        .add_tool::<read::ReadThread, Arc<ToolScribe>>()
        .add_subtoolset::<ToolDocumentToolContext>(document_toolset())
        .add_subtoolset::<ToolPropertiesToolContext>(properties_toolset())
        .add_subtoolset::<ToolCallToolContext>(call_toolset())
}

/// These are actually sent to the AI provider
pub fn all_tools() -> ToolSetWithPrompt {
    let toolset = subagent_toolset()
        .add_subtoolset::<ToolEmailToolContext>(email_toolset())
        .add_tool::<Subagent, ToolServiceContext>();
    let prompt = prompts::TOOLS_PROMPT;
    let toolset = Arc::new(toolset);
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
        toolset: Arc::new(AsyncToolSet::new()),
    }
}

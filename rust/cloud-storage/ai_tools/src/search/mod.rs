use crate::AiToolSet;
use ai::tool::AsyncToolSet;

#[allow(unused)]
mod perplexity_search;

/// Schemas for frontend type generation for the builtin claude web search tool
/// <https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool>
/// This tool is built into anthropic so is not included in the toolset / sent in the request
pub mod anthropic_web_search;

mod unified;

pub fn search_toolset() -> AiToolSet {
    AsyncToolSet::new()
        .add_tool::<unified::UnifiedSearch>()
        .expect("failed to add unified search tool")
}

use crate::AiToolSet;
use ai::tool::AsyncToolSet;

mod unified;
mod web;

pub fn search_toolset() -> AiToolSet {
    AsyncToolSet::new()
        .add_tool::<unified::UnifiedSearch>()
        .expect("failed to add unified search tool")
        .add_tool::<web::WebSearch>()
        .expect("fialed to add web search tool")
}

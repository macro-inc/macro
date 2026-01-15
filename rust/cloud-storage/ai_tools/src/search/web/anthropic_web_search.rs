use ai_toolset::schema::PhantomTool;
use anthropic::types::response::web_search::{WebSearchResponse, WebSearchToolCall};
use lazy_static::lazy_static;

lazy_static! {
    pub static ref anthropic_web_search_tool: PhantomTool<WebSearchToolCall, WebSearchResponse> =
        PhantomTool::new("web_search");
}

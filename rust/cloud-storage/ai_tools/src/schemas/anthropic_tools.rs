use ai_toolset::schema::PhantomTool;
use anthropic::types::response::code_execution::{
    BashCodeExecutionResponse, BashCodeExecutionToolCall, TextEditorCodeExecutionResponse,
    TextEditorCodeExecutionToolCall,
};
use anthropic::types::response::web_fetch::{WebFetchResponse, WebFetchToolCall};
use anthropic::types::response::web_search::{WebSearchResponse, WebSearchToolCall};

/// Schemas for frontend type generation for the builtin claude web search tool
/// <https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool>
/// This tool is built into anthropic so is not included in the toolset / sent in the request
pub fn web_search() -> PhantomTool<WebSearchToolCall, WebSearchResponse> {
    PhantomTool::new("web_search")
}

pub fn web_fetch() -> PhantomTool<WebFetchToolCall, WebFetchResponse> {
    PhantomTool::new("web_fetch")
}

pub fn bash_code_execution() -> PhantomTool<BashCodeExecutionToolCall, BashCodeExecutionResponse> {
    PhantomTool::new("bash_code_execution")
}

pub fn text_editor_code_execution()
-> PhantomTool<TextEditorCodeExecutionToolCall, TextEditorCodeExecutionResponse> {
    PhantomTool::new("text_editor_code_execution")
}

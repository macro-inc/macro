use ai::tool::schema::PhantomTool;
use anthropic::types::response::web_fetch::{WebFetchResponse, WebFetchToolCall};
use lazy_static::lazy_static;

lazy_static! {
    pub static ref anthropic_web_fetch_tool: PhantomTool<WebFetchToolCall, WebFetchResponse> =
        PhantomTool::new("web_fetch");
}

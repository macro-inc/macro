use super::types::ServerTool;
use lazy_static::lazy_static;
use serde_json::Value;

lazy_static! {
    pub static ref WEB_SEARCH_TOOL: ServerTool = ServerTool {
        name: "web_search".into(),
        r#type: "web_search_20250305".into(),
        args: Value::Null,
    };
    pub static ref WEB_FETCH_TOOL: ServerTool = ServerTool {
        name: "web_fetch".into(),
        r#type: "web_fetch_20250910".into(),
        args: Value::Null,
    };
}

pub static WEB_FETCH_TOOL_HEADER: (reqwest::header::HeaderName, reqwest::header::HeaderValue) = (
    reqwest::header::HeaderName::from_static("anthropic-beta"),
    reqwest::header::HeaderValue::from_static("web-fetch-2025-09-10"),
);

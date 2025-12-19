use super::types::ServerTool;
use lazy_static::lazy_static;
use serde_json::Value;

lazy_static! {
    pub static ref WEB_SEARCH_TOOL: ServerTool = ServerTool {
        name: "web_search".into(),
        r#type: "web_search_20250305".into(),
        args: Value::Null,
    };
}

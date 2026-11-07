use super::types::ServerTool;
use lazy_static::lazy_static;
use serde_json::Value;

lazy_static! {
    pub static ref CODE_EXECUTION_TOOL: ServerTool = ServerTool {
        name: "code_execution".into(),
        r#type: "code_execution_20250825".into(),
        args: Value::Null,
    };
}

pub static CODE_EXECUTION_TOOL_HEADER: (reqwest::header::HeaderName, reqwest::header::HeaderValue) = (
    reqwest::header::HeaderName::from_static("anthropic-beta"),
    reqwest::header::HeaderValue::from_static("code-execution-2025-08-25"),
);

use super::types::ServerTool;
use crate::types::request::*;
use lazy_static::lazy_static;
use regex::{Captures, Regex};
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
    pub static ref CODE_EXECUTION_TOOL: ServerTool = ServerTool {
        name: "code_execution".into(),
        r#type: "code_execution_20250825".into(),
        args: Value::Null,
    };
}

pub static WEB_FETCH_TOOL_HEADER: (reqwest::header::HeaderName, reqwest::header::HeaderValue) = (
    reqwest::header::HeaderName::from_static("anthropic-beta"),
    reqwest::header::HeaderValue::from_static("web-fetch-2025-09-10"),
);

pub static CODE_EXECUTION_TOOL_HEADER: (reqwest::header::HeaderName, reqwest::header::HeaderValue) = (
    reqwest::header::HeaderName::from_static("anthropic-beta"),
    reqwest::header::HeaderValue::from_static("code-execution-2025-08-25"),
);

lazy_static! {
    static ref re: Regex = Regex::new("<m-link>(.+?)</m-link>").expect("link-regex");
}

fn replace_links(s: String) -> String {
    re.replace_all(&s, |caps: &Captures| {
        let json_str = &caps[1];
        serde_json::from_str::<serde_json::Value>(json_str)
            .ok()
            .and_then(|v| v.get("url")?.as_str().map(String::from))
            .unwrap_or_else(|| caps[0].to_string())
    })
    .into_owned()
}

// yes this is a compute virus
pub(crate) fn transform_request_web_fetch(
    mut request: CreateMessageRequestBody,
) -> CreateMessageRequestBody {
    request.messages = request
        .messages
        .into_iter()
        .map(|mut message| {
            message.content = match message.content {
                RequestContent::Text(t) => RequestContent::Text(replace_links(t)),
                RequestContent::Blocks(b) => RequestContent::Blocks(
                    b.into_iter()
                        .map(|b| match b {
                            RequestContentKind::Text {
                                text,
                                cache_control,
                                citations,
                            } => RequestContentKind::Text {
                                text: replace_links(text),
                                cache_control,
                                citations,
                            },
                            other => other,
                        })
                        .collect(),
                ),
            };
            message
        })
        .collect();
    request
}

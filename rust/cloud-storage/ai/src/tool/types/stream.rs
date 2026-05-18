use crate::types::{AiError, Usage};
use futures::stream::Stream;
use serde::Serialize;
use std::fmt::Debug;
use std::pin::Pin;

pub type AiStream<'a, T> = Pin<Box<dyn Stream<Item = Result<T, AiError>> + Send + 'a>>;
pub type ChatCompletionStream<'a> = AiStream<'a, StreamPart>;
pub(crate) type ExtendedPartStream<'a, T> = AiStream<'a, PartOrExt<T>>;

#[derive(Debug, Clone)]
pub(crate) enum PartOrExt<T: Debug> {
    Part(StreamPart),
    Ext(T),
}

#[derive(Debug, Clone)]
pub enum StreamPart {
    Content(String),
    ToolCall(ToolCall),
    ToolResponse(ToolResponse),
    Usage(Usage),
}

#[derive(Debug, Clone)]
pub enum ToolResponse {
    Json {
        id: String,
        json: serde_json::Value,
        name: String,
    },
    Err {
        id: String,
        name: String,
        description: String,
    },
}

impl TryFrom<PartialToolCall> for ToolCall {
    type Error = serde_json::Error;
    fn try_from(value: PartialToolCall) -> Result<Self, Self::Error> {
        let raw = if value.json.is_empty() {
            "{}"
        } else {
            &value.json
        };
        serde_json::from_str(raw).map(|json| Self {
            id: value.id,
            name: value.name,
            json,
            mcp: None,
        })
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct McpInfo {
    pub service: String,
    pub tool_name: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub json: serde_json::Value,
    pub mcp: Option<McpInfo>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub(crate) struct PartialToolCall {
    pub id: String,
    pub name: String,
    pub json: String,
}

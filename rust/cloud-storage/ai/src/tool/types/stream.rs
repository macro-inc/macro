use crate::types::{Usage, AiError};
use futures::stream::Stream;
use serde::Serialize;
use std::pin::Pin;

pub type ChatCompletionStream<'a> =
    Pin<Box<dyn Stream<Item = Result<StreamPart, AiError>> + Send + 'a>>;

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
        serde_json::from_str(&value.json).map(|json| Self {
            id: value.id,
            name: value.name,
            json,
        })
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub json: serde_json::Value,
}

#[derive(Debug, Clone, Default, Serialize)]
pub(crate) struct PartialToolCall {
    pub id: String,
    pub name: String,
    pub json: String,
}

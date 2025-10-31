use super::response::MessageResponse;
/// https://docs.claude.com/en/docs/build-with-claude/streaming#content-block-delta-types
/// stream response is comprised of:
/// A message_start event
/// Potentially multiple content blocks, each of which contains:
/// A content_block_start event
/// Potentially multiple content_block_delta events
/// A content_block_stop event
/// A message_delta event
/// A message_stop event
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    MessageStart {
        message: MessageResponse,
    }, // contains message type with empty content
    ContentBlockStart {
        index: u32,
        content_block: ContentDeltaEvent,
    },
    ContentBlockDelta {
        index: u32,
        delta: ContentDeltaEvent,
    },
    ContentBlockStop {
        index: u32,
    },
    MessageDelta {
        delta: MessageResponse,
    }, // changes to top level message
    MessageStop,
    Ping,
    Error {
        error: Error,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentDeltaEvent {
    TextDelta { text: String },
    InputJsonDelta { partial_json: String },
    ThinkingDelta { thinking: String },
    SignatureDelta { signature: String },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Error {
    OverloadedError { message: String },
    OtherError { message: String },
}

#[cfg(test)]
mod test {
    use serde_json::{Value, json};

    use super::*;
    use crate::types::providers::anthropic::*;

    fn error() -> Value {
        json!(
            {"error": {"type": "overloaded_error", "message": "Overloaded"}, "type": "error"}
        )
    }

    fn start() -> Value {
        json!({
            "type":"message_start",
            "message":{
                "id":"abc","type":"message","role":"assistant","model":"claude-sonnet-4-5-20250929","stop_sequence":null,
                "usage":{"input_tokens":472,"output_tokens":2},"content":[],"stop_reason":null}})
    }

    #[test]
    fn test_se_start() {
        let se = serde_json::to_value(&StreamEvent::MessageStart {
            message: MessageResponse {
                id: "abc".into(),
                r#type: "message".into(),
                container: None,
                content: Content::Array(vec![]),
                role: Role::Assistant,
                context_management: None,
                model: "claude-sonnet-4-5-20250929".into(),
                stop_sequence: None,
                stop_reason: None,
                usage: Usage {
                    cache_creation: None,
                    cache_creation_input_tokens: None,
                    cache_read_input_tokens: None,
                    input_tokens: 472,
                    output_tokens: 2,
                    server_tool_use: None,
                    service_tier: None,
                },
            },
        })
        .expect("se start");
        assert_eq!(se, start(), "start");
    }

    #[test]
    fn test_se_err() {
        let se = serde_json::to_value(&StreamEvent::Error {
            error: Error::OverloadedError {
                message: "Overloaded".into(),
            },
        })
        .expect("se str");

        assert_eq!(se, error(), "serialize error")
    }

    #[test]
    fn test_de_error() {
        let de =
            serde_json::from_str::<StreamEvent>(&serde_json::to_string(&error()).expect("str"))
                .expect("deserialize_error");
        assert!(
            if let StreamEvent::Error { .. } = de {
                true
            } else {
                false
            },
            "deserialize error"
        );
    }
}

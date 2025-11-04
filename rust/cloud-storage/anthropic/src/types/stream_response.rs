use super::response::MessageResponse;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    MessageStart {
        message: MessageResponse,
    },
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
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum StreamResult {
    #[serde(rename = "error")]
    Err { error: StreamError },
    #[serde(untagged)]
    Ok(StreamEvent),
}

impl StreamResult {
    pub fn into_result(self) -> Result<StreamEvent, StreamError> {
        self.into()
    }
}

impl Into<Result<StreamEvent, StreamError>> for StreamResult {
    fn into(self) -> Result<StreamEvent, StreamError> {
        match self {
            Self::Err { error: e } => Err(e),
            Self::Ok(o) => Ok(o),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentDeltaEvent {
    #[serde(rename = "text")]
    StartTextDelta {
        text: String,
    },
    TextDelta {
        text: String,
    },
    InputJsonDelta {
        partial_json: String,
    },
    ThinkingDelta {
        thinking: String,
    },
    SignatureDelta {
        signature: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamError {
    OverloadedError { message: String },
    OtherError { message: String },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamErrorWrapper {
    Error(StreamError),
}

#[cfg(test)]
mod test {
    use serde_json::{Value, json};

    use super::*;
    use crate::types::request::*;
    use crate::types::response::*;

    fn error() -> Value {
        json!(
            {"error": {"type": "overloaded_error", "message": "Overloaded"}, "type": "error"}
        )
    }

    fn start() -> Value {
        json!({
            "type":"message_start",
            "message":{
                "id":"abc",
                "type":"message",
                "role":"assistant",
                "model":"claude-sonnet-4-5-20250929",
                "stop_sequence":null,
                "usage": {"input_tokens":472,"output_tokens":2},
                "content":[],
                "stop_reason":null}})
    }

    fn content_block_start_text() -> Value {
        json!({"type":"content_block_start","index":0,"content_block":{"type":"text_delta","text":""}})
    }

    fn content_block_start_tool_use() -> Value {
        json!({"type":"content_block_start","index":1,"content_block":{"type":"input_json_delta","partial_json":""}})
    }

    fn content_block_delta_text() -> Value {
        json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}})
    }

    fn content_block_delta_json() -> Value {
        json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"location\":\""}})
    }

    fn content_block_stop() -> Value {
        json!({"type":"content_block_stop","index":0})
    }

    fn message_delta() -> Value {
        json!({
            "type":"message_delta",
            "delta": {
                "id":"abc",
                "type":"message",
                "role":"assistant",
                "model":"claude-sonnet-4-5-20250929",
                "stop_sequence":null,
                "usage": {
                    "input_tokens":472,
                    "output_tokens":2},
                "content":[],
                "stop_reason":null
            }
        })
    }

    fn message_stop() -> Value {
        json!({"type":"message_stop"})
    }

    fn ping() -> Value {
        json!({"type":"ping"})
    }

    #[test]
    fn test_se_start() {
        let se = serde_json::to_value(&StreamEvent::MessageStart {
            message: MessageResponse {
                r#type: Some("message".into()),
                id: Some("abc".into()),
                container: None,
                content: Some(Content::Array(vec![])),
                role: Some(Role::Assistant),
                context_management: None,
                model: Some("claude-sonnet-4-5-20250929".into()),
                stop_sequence: None,
                stop_reason: None,
                usage: Some(Usage {
                    cache_creation: None,
                    cache_creation_input_tokens: None,
                    cache_read_input_tokens: None,
                    input_tokens: 472,
                    output_tokens: 2,
                    server_tool_use: None,
                    service_tier: None,
                }),
            },
        })
        .expect("se start");
        assert_eq!(se, start(), "start");
    }

    #[test]
    fn test_se_err() {
        let se = serde_json::to_value(StreamResult::Err {
            error: StreamError::OverloadedError {
                message: "Overloaded".into(),
            },
        })
        .expect("se str");

        assert_eq!(se, error(), "serialize error")
    }

    #[test]
    fn test_de_error() {
        let de =
            serde_json::from_str::<StreamResult>(&serde_json::to_string(&error()).expect("str"))
                .expect("deserialize_error");
        assert!(de.into_result().is_err(), "deserialize error");
    }

    #[test]
    fn test_de_start() {
        let de =
            serde_json::from_str::<StreamEvent>(&serde_json::to_string(&start()).expect("str"))
                .expect("deserialize_start");
        assert!(
            if let StreamEvent::MessageStart { .. } = de {
                true
            } else {
                false
            },
            "deserialize start"
        );
    }

    #[test]
    fn test_se_content_block_start_text() {
        let se = serde_json::to_value(&StreamEvent::ContentBlockStart {
            index: 0,
            content_block: ContentDeltaEvent::TextDelta { text: "".into() },
        })
        .expect("se content_block_start_text");
        assert_eq!(se, content_block_start_text(), "content_block_start_text");
    }

    #[test]
    fn test_de_content_block_start_text() {
        let de = serde_json::from_str::<StreamEvent>(
            &serde_json::to_string(&content_block_start_text()).expect("str"),
        )
        .expect("deserialize_content_block_start_text");
        assert!(
            if let StreamEvent::ContentBlockStart { .. } = de {
                true
            } else {
                false
            },
            "deserialize content_block_start_text"
        );
    }

    #[test]
    fn test_se_content_block_start_tool_use() {
        let se = serde_json::to_value(&StreamEvent::ContentBlockStart {
            index: 1,
            content_block: ContentDeltaEvent::InputJsonDelta {
                partial_json: "".into(),
            },
        })
        .expect("se content_block_start_tool_use");
        assert_eq!(
            se,
            content_block_start_tool_use(),
            "content_block_start_tool_use"
        );
    }

    #[test]
    fn test_de_content_block_start_tool_use() {
        let de = serde_json::from_str::<StreamEvent>(
            &serde_json::to_string(&content_block_start_tool_use()).expect("str"),
        )
        .expect("deserialize_content_block_start_tool_use");
        assert!(
            if let StreamEvent::ContentBlockStart { .. } = de {
                true
            } else {
                false
            },
            "deserialize content_block_start_tool_use"
        );
    }

    #[test]
    fn test_se_content_block_delta_text() {
        let se = serde_json::to_value(&StreamEvent::ContentBlockDelta {
            index: 0,
            delta: ContentDeltaEvent::TextDelta {
                text: "Hello".into(),
            },
        })
        .expect("se content_block_delta_text");
        assert_eq!(se, content_block_delta_text(), "content_block_delta_text");
    }

    #[test]
    fn test_de_content_block_delta_text() {
        let de = serde_json::from_str::<StreamEvent>(
            &serde_json::to_string(&content_block_delta_text()).expect("str"),
        )
        .expect("deserialize_content_block_delta_text");
        assert!(
            if let StreamEvent::ContentBlockDelta { .. } = de {
                true
            } else {
                false
            },
            "deserialize content_block_delta_text"
        );
    }

    #[test]
    fn test_se_content_block_delta_json() {
        let se = serde_json::to_value(&StreamEvent::ContentBlockDelta {
            index: 1,
            delta: ContentDeltaEvent::InputJsonDelta {
                partial_json: "{\"location\":\"".into(),
            },
        })
        .expect("se content_block_delta_json");
        assert_eq!(se, content_block_delta_json(), "content_block_delta_json");
    }

    #[test]
    fn test_de_content_block_delta_json() {
        let de = serde_json::from_str::<StreamEvent>(
            &serde_json::to_string(&content_block_delta_json()).expect("str"),
        )
        .expect("deserialize_content_block_delta_json");
        assert!(
            if let StreamEvent::ContentBlockDelta { .. } = de {
                true
            } else {
                false
            },
            "deserialize content_block_delta_json"
        );
    }

    #[test]
    fn test_se_content_block_stop() {
        let se = serde_json::to_value(&StreamEvent::ContentBlockStop { index: 0 })
            .expect("se content_block_stop");
        assert_eq!(se, content_block_stop(), "content_block_stop");
    }

    #[test]
    fn test_de_content_block_stop() {
        let de = serde_json::from_str::<StreamEvent>(
            &serde_json::to_string(&content_block_stop()).expect("str"),
        )
        .expect("deserialize_content_block_stop");
        assert!(
            if let StreamEvent::ContentBlockStop { .. } = de {
                true
            } else {
                false
            },
            "deserialize content_block_stop"
        );
    }

    #[test]
    fn test_se_message_delta() {
        let se = serde_json::to_value(&StreamEvent::MessageDelta {
            delta: MessageResponse {
                id: Some("abc".into()),
                r#type: Some("message".into()),
                container: None,
                content: Some(Content::Array(vec![])),
                role: Some(Role::Assistant),
                context_management: None,
                model: Some("claude-sonnet-4-5-20250929".into()),
                stop_sequence: None,
                stop_reason: None,
                usage: Some(Usage {
                    cache_creation: None,
                    cache_creation_input_tokens: None,
                    cache_read_input_tokens: None,
                    input_tokens: 472,
                    output_tokens: 2,
                    server_tool_use: None,
                    service_tier: None,
                }),
            },
        })
        .expect("se message_delta");
        assert_eq!(se, message_delta(), "message_delta");
    }

    #[test]
    fn test_de_message_delta() {
        let de = serde_json::from_str::<StreamEvent>(
            &serde_json::to_string(&message_delta()).expect("str"),
        )
        .expect("deserialize_message_delta");
        assert!(
            if let StreamEvent::MessageDelta { .. } = de {
                true
            } else {
                false
            },
            "deserialize message_delta"
        );
    }

    #[test]
    fn test_se_message_stop() {
        let se = serde_json::to_value(&StreamEvent::MessageStop).expect("se message_stop");
        assert_eq!(se, message_stop(), "message_stop");
    }

    #[test]
    fn test_de_message_stop() {
        let de = serde_json::from_str::<StreamEvent>(
            &serde_json::to_string(&message_stop()).expect("str"),
        )
        .expect("deserialize_message_stop");
        assert!(
            if let StreamEvent::MessageStop = de {
                true
            } else {
                false
            },
            "deserialize message_stop"
        );
    }

    #[test]
    fn test_se_ping() {
        let se = serde_json::to_value(&StreamEvent::Ping).expect("se ping");
        assert_eq!(se, ping(), "ping");
    }

    #[test]
    fn test_de_ping() {
        let de = serde_json::from_str::<StreamEvent>(&serde_json::to_string(&ping()).expect("str"))
            .expect("deserialize_ping");
        assert!(
            if let StreamEvent::Ping = de {
                true
            } else {
                false
            },
            "deserialize ping"
        );
    }
}

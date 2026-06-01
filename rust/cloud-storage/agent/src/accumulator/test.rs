use super::*;
use crate::stream::{McpInfo, ToolCall, Usage};
use serde_json::json;

fn content(s: &str) -> StreamPart {
    StreamPart::Content(s.to_owned())
}

fn thinking(s: &str) -> StreamPart {
    StreamPart::Thinking(s.to_owned())
}

fn tool_call(id: &str, name: &str) -> StreamPart {
    StreamPart::ToolCall(ToolCall {
        id: id.to_owned(),
        name: name.to_owned(),
        json: json!({"q": "x"}),
        mcp: None,
    })
}

#[test]
fn consecutive_text_is_merged_on_access() {
    let mut acc = StreamAccumulator::new();
    acc.push(content("Hello"));
    acc.push(content(", "));
    acc.push(content("world"));

    assert_eq!(
        acc.into_parts(),
        vec![AssistantMessagePart::Text {
            text: "Hello, world".to_owned()
        }]
    );
}

#[test]
fn consecutive_thinking_is_merged_on_access() {
    let mut acc = StreamAccumulator::new();
    acc.push(thinking("Let me "));
    acc.push(thinking("think."));

    assert_eq!(
        acc.into_parts(),
        vec![AssistantMessagePart::Thinking {
            thinking: "Let me think.".to_owned()
        }]
    );
}

#[test]
fn text_separated_by_a_tool_call_is_not_merged() {
    let mut acc = StreamAccumulator::new();
    acc.push(content("before"));
    acc.push(tool_call("c1", "search"));
    acc.push(content("after"));

    assert_eq!(
        acc.into_parts(),
        vec![
            AssistantMessagePart::Text {
                text: "before".to_owned()
            },
            AssistantMessagePart::ToolCall {
                name: "search".to_owned(),
                json: json!({"q": "x"}),
                id: "c1".to_owned(),
            },
            AssistantMessagePart::Text {
                text: "after".to_owned()
            },
        ]
    );
}

#[test]
fn text_and_thinking_are_not_merged_together() {
    let mut acc = StreamAccumulator::new();
    acc.push(thinking("reasoning"));
    acc.push(content("answer"));

    assert_eq!(
        acc.into_parts(),
        vec![
            AssistantMessagePart::Thinking {
                thinking: "reasoning".to_owned()
            },
            AssistantMessagePart::Text {
                text: "answer".to_owned()
            },
        ]
    );
}

#[test]
fn push_returns_the_unmerged_part_for_forwarding() {
    let mut acc = StreamAccumulator::new();

    let first = acc.push(content("Hel")).cloned();
    assert_eq!(
        first,
        Some(AssistantMessagePart::Text {
            text: "Hel".to_owned()
        })
    );

    let second = acc.push(content("lo")).cloned();
    assert_eq!(
        second,
        Some(AssistantMessagePart::Text {
            text: "lo".to_owned()
        }),
        "individual deltas are returned unmerged so consumers can stream them"
    );

    // ...but accessing the accumulated parts merges them.
    assert_eq!(
        acc.into_parts(),
        vec![AssistantMessagePart::Text {
            text: "Hello".to_owned()
        }]
    );
}

#[test]
fn empty_text_and_thinking_are_skipped() {
    let mut acc = StreamAccumulator::new();
    assert!(acc.push(content("")).is_none());
    assert!(acc.push(thinking("")).is_none());
    assert!(acc.is_empty());
    assert!(acc.into_parts().is_empty());
}

#[test]
fn usage_events_are_ignored() {
    let mut acc = StreamAccumulator::new();
    assert!(
        acc.push(StreamPart::Usage(Usage {
            input_tokens: 10,
            output_tokens: 20,
        }))
        .is_none()
    );
    assert!(acc.is_empty());
}

#[test]
fn mcp_tool_calls_preserve_service_info() {
    let mut acc = StreamAccumulator::new();
    acc.push(StreamPart::ToolCall(ToolCall {
        id: "call_mcp".to_owned(),
        name: "slack__slack_search".to_owned(),
        json: json!({"query": "standup"}),
        mcp: Some(McpInfo {
            service: "slack".to_owned(),
            tool_name: "slack_search".to_owned(),
            display_name: Some("Search Slack".to_owned()),
        }),
    }));

    assert_eq!(
        acc.into_parts(),
        vec![AssistantMessagePart::McpToolCall {
            name: "slack_search".to_owned(),
            service: "slack".to_owned(),
            display_name: Some("Search Slack".to_owned()),
            json: json!({"query": "standup"}),
            id: "call_mcp".to_owned(),
        }]
    );
}

#[test]
fn tool_responses_convert_to_parts() {
    let mut acc = StreamAccumulator::new();
    acc.push(StreamPart::ToolResponse(ToolResponse::Json {
        id: "c1".to_owned(),
        name: "search".to_owned(),
        json: json!({"results": []}),
    }));
    acc.push(StreamPart::ToolResponse(ToolResponse::Err {
        id: "c2".to_owned(),
        name: "delete".to_owned(),
        description: "permission denied".to_owned(),
    }));

    assert_eq!(
        acc.into_parts(),
        vec![
            AssistantMessagePart::ToolCallResponseJson {
                name: "search".to_owned(),
                json: json!({"results": []}),
                id: "c1".to_owned(),
            },
            AssistantMessagePart::ToolCallErr {
                name: "delete".to_owned(),
                description: "permission denied".to_owned(),
                id: "c2".to_owned(),
            },
        ]
    );
}

#[test]
fn parts_does_not_consume_and_matches_into_parts() {
    let mut acc = StreamAccumulator::new();
    acc.push(content("a"));
    acc.push(content("b"));

    let borrowed = acc.parts();
    let owned = acc.into_parts();
    assert_eq!(borrowed, owned);
    assert_eq!(
        owned,
        vec![AssistantMessagePart::Text {
            text: "ab".to_owned()
        }]
    );
}

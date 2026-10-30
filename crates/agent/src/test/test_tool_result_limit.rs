use crate::convert::to_rig_messages_limited;
use crate::hook::{BridgeInputs, StreamBridge, ToolLoads};
use crate::stream::{StreamPart, ToolResponse};
use crate::tool_result_limit::ToolResultLimit;
use crate::types::{AssistantMessagePart, ChatMessage, ChatMessageContent, Role};
use rig_agent::agent::ToolResultAction;
use rig_agent::tool::ToolOutput;
use rig_core::message::{Message, ToolResultContent, UserContent};
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

fn limited_bridge(
    limit: &ToolResultLimit,
) -> (
    StreamBridge,
    tokio::sync::mpsc::UnboundedReceiver<Result<StreamPart, crate::AgentError>>,
) {
    StreamBridge::channel(
        BridgeInputs {
            routing: Arc::new(|_| None),
            loaded_buffer: Arc::new(Mutex::new(Vec::new())),
            register_loaded: Arc::new(|_| {
                Box::pin(async {}) as Pin<Box<dyn Future<Output = ()> + Send>>
            }),
            tool_loads: ToolLoads::default(),
            user_tool_finisher: None,
            stream_tool_calls: false,
            result_limit: Some(limit.clone()),
        },
        Arc::new(vec![]),
        CancellationToken::new(),
    )
}

/// A JSON result of 100,000 characters once serialized: past the limit.
fn huge_result() -> serde_json::Value {
    serde_json::json!({ "logs": "é".repeat(99_989) })
}

#[tokio::test]
async fn a_result_past_the_limit_reaches_the_model_cut_and_the_stream_whole() {
    let limit = ToolResultLimit::default();
    let (bridge, mut rx) = limited_bridge(&limit);
    let result = huge_result();

    let action = bridge
        .handle_tool_result(
            "SearchLogs",
            Some("toolu_1"),
            "internal-1",
            "{}",
            &ToolOutput::json(result.clone()),
            true,
        )
        .await;

    let ToolResultAction::Rewrite(shown) = action else {
        panic!("the model's view is cut, got {action:?}");
    };
    let shown = shown.as_text().expect("the cut view is text");
    let full = result.to_string();
    let preview: String = full.chars().take(16_000).collect();
    assert_eq!(
        shown,
        format!(
            "{preview}\n\n[Truncated: this result is 100000 characters and only the first \
             16000 are shown. Call ReadToolResult with tool_call_id \"toolu_1\" and offset \
             16000 to read on.]"
        )
    );
    let Ok(StreamPart::ToolResponse(ToolResponse::Json { json, .. })) = rx.try_recv().unwrap()
    else {
        panic!("the stream records the result");
    };
    assert_eq!(json, result);

    // The rest reads back in pages to the result's last character.
    let mut read = preview;
    let mut offset = Some(16_000);
    while let Some(from) = offset {
        let page = limit
            .read("toolu_1", from, 32_000)
            .expect("the result is kept");
        assert_eq!(page.total_chars, 100_000);
        read.push_str(&page.content);
        offset = page.next_offset;
    }
    assert_eq!(read, full);
}

#[tokio::test]
async fn a_result_within_the_limit_reaches_the_model_as_it_is() {
    let limit = ToolResultLimit::default();
    let (bridge, _rx) = limited_bridge(&limit);

    let action = bridge
        .handle_tool_result(
            "SearchLogs",
            Some("toolu_2"),
            "internal-2",
            "{}",
            &ToolOutput::json(serde_json::json!({ "logs": "x".repeat(79_000) })),
            true,
        )
        .await;

    assert!(matches!(action, ToolResultAction::Keep));
    assert!(limit.read("toolu_2", 0, 10).is_none());
}

#[tokio::test]
async fn a_replayed_result_reads_as_it_did_in_its_turn() {
    let turn = ToolResultLimit::default();
    let (bridge, _rx) = limited_bridge(&turn);
    let result = huge_result();
    let ToolResultAction::Rewrite(in_turn) = bridge
        .handle_tool_result(
            "SearchLogs",
            Some("toolu_3"),
            "internal-3",
            "{}",
            &ToolOutput::json(result.clone()),
            true,
        )
        .await
    else {
        panic!("the model's view is cut");
    };

    // A later turn replays the logged result into a fresh limit.
    let later = ToolResultLimit::default();
    let history = [ChatMessage {
        role: Role::Assistant,
        content: ChatMessageContent::AssistantMessageParts(vec![
            AssistantMessagePart::ToolCall {
                name: "SearchLogs".to_owned(),
                json: serde_json::json!({}),
                id: "toolu_3".to_owned(),
            },
            AssistantMessagePart::ToolCallResponseJson {
                name: "SearchLogs".to_owned(),
                json: result,
                id: "toolu_3".to_owned(),
            },
        ]),
        attachments: None,
    }];
    let messages = to_rig_messages_limited(&history, &later);

    let Some(Message::User { content }) = messages.last() else {
        panic!("the result is replayed as a user message, got {messages:?}");
    };
    let UserContent::ToolResult(replayed) = content.first() else {
        panic!("the user message carries the tool result");
    };
    let ToolResultContent::Text(replayed) = replayed.content.first() else {
        panic!("the replayed result is text");
    };
    assert_eq!(Some(replayed.text.as_str()), in_turn.as_text());
    assert_eq!(
        later
            .read("toolu_3", 99_990, 32_000)
            .map(|page| page.content),
        Some("éééééééé\"}".to_owned())
    );
}

#[tokio::test]
async fn an_image_result_reaches_the_model_uncut() {
    let limit = ToolResultLimit::default();
    let (bridge, _rx) = limited_bridge(&limit);
    let image = crate::tool_media::model_output(serde_json::json!({
        "revision": "r1",
        "modelMedia": [{
            "type": "image",
            "mediaType": "image/png",
            "data": format!("iVBORw0KGgo{}", "A".repeat(100_000)),
        }],
    }))
    .expect("a bounded PNG");

    let action = bridge
        .handle_tool_result(
            "RenderCanvas",
            Some("toolu_4"),
            "internal-4",
            "{}",
            &image,
            true,
        )
        .await;

    assert!(matches!(action, ToolResultAction::Keep));
}

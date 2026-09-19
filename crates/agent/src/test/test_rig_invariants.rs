//! Canary tests pinning rig invariants this crate depends on but does not
//! implement itself. If a rig version bump drops one of these, the failure
//! shows up here instead of as a production 400.

use rig_core::OneOrMany;
use rig_core::message::{AssistantContent, Message, ToolCall, ToolFunction};
use rig_core::providers::anthropic::completion::{Content, Message as AnthropicMessage};

/// Anthropic's Messages API requires `tool_use.input` to be a JSON object.
///
/// rig's invalid-tool-call retry path replays the rejected call into history
/// with `arguments: null` when the model streamed no input (e.g. a zero-arg
/// tool like `get_me` called before being loaded), and older persisted
/// history can carry stringified arguments. Both must be coerced to an object
/// at the send boundary — rig ≥ 0.41 does this in its Anthropic serializer
/// (`coerce_tool_input`). This exact gap took down prod chat streams with
/// `messages.N.content.M.tool_use.input: Input should be an object`
/// (request `req_011CdzpQPd3VcpdDMBffecEE`), so pin it against future bumps.
#[test]
fn anthropic_wire_coerces_non_object_tool_use_input_to_object() {
    for arguments in [
        serde_json::Value::Null,
        serde_json::json!(""),
        serde_json::json!("not json"),
        serde_json::json!([1, 2, 3]),
        serde_json::json!(42),
    ] {
        let message = Message::Assistant {
            id: None,
            content: OneOrMany::one(AssistantContent::ToolCall(ToolCall::new(
                "toolu_test".to_string(),
                ToolFunction {
                    name: "get_me".to_string(),
                    arguments: arguments.clone(),
                },
            ))),
        };

        let wire: AnthropicMessage = message
            .try_into()
            .expect("assistant tool call must convert");
        let Content::ToolUse { input, .. } = wire.content.first() else {
            panic!("expected a tool_use content block for arguments {arguments:?}");
        };
        assert!(
            input.is_object(),
            "tool_use.input must serialize as an object for arguments {arguments:?}, got {input:?}"
        );
    }
}

/// A JSON-encoded object string must survive as the decoded object, not be
/// flattened to `{}` — replayed history from other providers stores arguments
/// this way.
#[test]
fn anthropic_wire_parses_stringified_object_tool_use_input() {
    let message = Message::Assistant {
        id: None,
        content: OneOrMany::one(AssistantContent::ToolCall(ToolCall::new(
            "toolu_test".to_string(),
            ToolFunction {
                name: "echo".to_string(),
                arguments: serde_json::json!("{\"value\":\"ok\"}"),
            },
        ))),
    };

    let wire: AnthropicMessage = message
        .try_into()
        .expect("assistant tool call must convert");
    let Content::ToolUse { input, .. } = wire.content.first() else {
        panic!("expected a tool_use content block");
    };
    assert_eq!(input, serde_json::json!({"value": "ok"}));
}

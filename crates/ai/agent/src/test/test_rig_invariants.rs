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

/// Gemini 3 rejects a function-call part that is missing `thought_signature`.
/// Native GenerateContent copies [`ToolCall::signature`] onto the part; that
/// is why Google ids do not ride the OpenAI-compatible Chat Completions path.
#[test]
fn gemini_wire_copies_tool_call_signature_onto_the_function_call_part() {
    use rig_core::providers::gemini::completion::gemini_api_types::{Part, PartKind};

    let message = Message::Assistant {
        id: None,
        content: OneOrMany::one(AssistantContent::ToolCall(
            ToolCall::new(
                "list-companies".to_string(),
                ToolFunction {
                    name: "ListCompanies".to_string(),
                    arguments: serde_json::json!({}),
                },
            )
            .with_signature(Some("thought-sig".to_owned())),
        )),
    };

    let content: rig_core::providers::gemini::completion::gemini_api_types::Content = message
        .try_into()
        .expect("assistant tool call must convert");
    let Part {
        thought_signature,
        part: PartKind::FunctionCall(call),
        ..
    } = content.parts.first().expect("one part")
    else {
        panic!("expected a functionCall part");
    };
    assert_eq!(call.name, "ListCompanies");
    assert_eq!(thought_signature.as_deref(), Some("thought-sig"));
}

/// The OpenAI Chat Completions serializer has no `extra_content` field, so a
/// Gemini thought signature stored on [`ToolCall::signature`] is dropped. Pin
/// that hole so a future rig bump either preserves it (and this assertion
/// fails for us to delete the native Gemini route) or stays dropped.
#[test]
fn openai_chat_completions_wire_drops_tool_call_signatures() {
    use rig_core::providers::openai::completion::Message as OpenAiMessage;

    let message = Message::Assistant {
        id: None,
        content: OneOrMany::one(AssistantContent::ToolCall(
            ToolCall::new(
                "list-companies".to_string(),
                ToolFunction {
                    name: "ListCompanies".to_string(),
                    arguments: serde_json::json!({}),
                },
            )
            .with_signature(Some("thought-sig".to_owned())),
        )),
    };

    let wire: Vec<OpenAiMessage> = message
        .try_into()
        .expect("assistant tool call must convert");
    let json = serde_json::to_value(&wire).expect("openai messages serialize");
    let dumped = json.to_string();
    assert!(
        dumped.contains("ListCompanies"),
        "expected a tool call on the wire: {dumped}"
    );
    assert!(
        !dumped.contains("thought-sig"),
        "Chat Completions must not silently start echoing signatures: {dumped}"
    );
    assert!(
        !dumped.contains("extra_content"),
        "Chat Completions gained extra_content; re-evaluate the native Gemini route: {dumped}"
    );
}

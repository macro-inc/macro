use super::completion_model_id;
use crate::model::types::Model;

#[test]
fn fireworks_short_name_becomes_the_account_path() {
    let model = Model::try_from("fireworks/kimi-k3").expect("routable id");
    assert_eq!(
        completion_model_id(&model),
        "accounts/fireworks/models/kimi-k3"
    );
}

#[test]
fn fireworks_account_path_is_sent_verbatim() {
    let model = Model::try_from("fireworks/accounts/fireworks/models/kimi-k3")
        .expect("full path is still one provider segment");
    assert_eq!(
        completion_model_id(&model),
        "accounts/fireworks/models/kimi-k3"
    );
}

#[test]
fn other_compatible_providers_keep_the_catalog_name() {
    let model = Model::try_from("cerebras/gpt-oss-120b").expect("routable id");
    assert_eq!(completion_model_id(&model), "gpt-oss-120b");

    let gemini = Model::try_from("google/gemini-3.8-flash").expect("routable id");
    assert_eq!(completion_model_id(&gemini), "gemini-3.8-flash");
}

#[test]
fn compatible_transport_omits_native_tool_pixels_on_live_results_and_replay() {
    use rig_core::{
        OneOrMany,
        completion::CompletionRequest,
        message::{Message, ToolResultContent, UserContent},
    };
    let image = crate::tool_media::model_output(serde_json::json!({"revision":"frozen", "modelMedia":[{"type":"image","mediaType":"image/png","data":"iVBORw0KGgo="}]})).expect("bounded image");
    let request = CompletionRequest {
        model: None,
        preamble: None,
        chat_history: OneOrMany::one(Message::User {
            content: OneOrMany::one(UserContent::tool_result_with_call_id(
                "render",
                "call-1".to_owned(),
                image.into_content(),
            )),
        }),
        documents: vec![],
        tools: vec![],
        temperature: None,
        max_tokens: None,
        tool_choice: None,
        additional_params: None,
        output_schema: None,
        record_telemetry_content: false,
    };
    let adapted = super::compatible_media(request);
    let Message::User { content } = adapted.chat_history.first_ref() else {
        panic!("user tool result")
    };
    let UserContent::ToolResult(result) = content.first_ref() else {
        panic!("tool result")
    };
    assert!(
        result
            .content
            .iter()
            .all(|part| !matches!(part, ToolResultContent::Image(_)))
    );
    let wire = serde_json::to_string(&adapted.chat_history).expect("serialize");
    assert!(wire.contains("frozen"));
    assert!(wire.contains("cannot inspect tool images"));
    assert!(!wire.contains("iVBOR"));
    // Every request is adapted at the provider boundary, including stored history.
    assert_eq!(
        serde_json::to_string(&super::compatible_media(adapted).chat_history).expect("replay"),
        wire
    );
}

use aws_sdk_sqs::types::Message;
use models_ai_projection::AiProjectionQueueMessage;

use super::parse_message;

fn sqs_message(body: &str) -> Message {
    Message::builder().body(body).build()
}

#[test]
fn parse_message_deserializes_valid_body() {
    let original = AiProjectionQueueMessage {
        ai_projection_id: "inbox/important".to_string(),
        target_id: "macro|test@macro.com".to_string(),
        prompt_hash: "abc123".to_string(),
    };
    let body = serde_json::to_string(&original).unwrap();

    let parsed = parse_message(&sqs_message(&body)).unwrap();

    assert_eq!(parsed.ai_projection_id, original.ai_projection_id);
    assert_eq!(parsed.target_id, original.target_id);
    assert_eq!(parsed.prompt_hash, original.prompt_hash);
}

#[test]
fn parse_message_errors_on_malformed_body() {
    assert!(parse_message(&sqs_message("not json")).is_err());
}

#[test]
fn parse_message_errors_on_empty_body() {
    assert!(parse_message(&Message::builder().build()).is_err());
}

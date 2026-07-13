#[allow(unused_imports)]
use super::*;

#[test]
fn test_deserialize_connections_message() {
    let input_json = include_str!("../../../tests/fixtures/add_connection.json");
    let msg: Option<ContactsNodes> = serde_json::from_str(input_json).ok();
    assert!(msg.is_some());
    assert_eq!(msg.unwrap().users.len(), 3);
}

fn generate_sqs_message() -> aws_sdk_sqs::types::Message {
    let input_json = include_str!("../../../tests/fixtures/add_connection.json");
    aws_sdk_sqs::types::Message::builder()
        .set_body(Some(input_json.to_string()))
        .build()
}

#[test]
fn test_message_from_aws_sqs() {
    let sqs_message = generate_sqs_message();
    let message = crate::inbound::worker::message_from_sqs(&sqs_message);
    assert!(message.is_some(), "Could not parse body from sqs message");
    assert_eq!(message.unwrap().users.len(), 3);
}

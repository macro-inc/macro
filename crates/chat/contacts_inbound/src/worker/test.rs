use super::*;

fn generate_sqs_message() -> aws_sdk_sqs::types::Message {
    let input_json = include_str!("../../../contacts_core/tests/fixtures/add_connection.json");
    aws_sdk_sqs::types::Message::builder()
        .set_body(Some(input_json.to_string()))
        .build()
}

#[test]
fn test_message_from_aws_sqs() {
    let sqs_message = generate_sqs_message();
    let message = message_from_sqs(&sqs_message);
    let Some(ContactsMessage::Nodes(message)) = message else {
        panic!("Could not parse body as a contacts-nodes message");
    };
    assert_eq!(message.users.len(), 3);
}

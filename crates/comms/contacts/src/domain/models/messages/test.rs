use super::*;

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

#[test]
fn explicit_connections_are_a_separate_message_shape() {
    let connections = vec![ContactConnection::new(
        user("owner@example.com"),
        user("contact@example.com"),
    )];
    let serialized = serde_json::to_value(ContactConnections::new(connections.clone())).unwrap();

    assert!(serialized.get("users").is_none());
    assert_eq!(
        serde_json::from_value::<ContactConnections>(serialized)
            .unwrap()
            .connections,
        connections
    );
}

#[test]
fn consumer_deserializes_existing_nodes_message() {
    let message: ContactsMessage = serde_json::from_str(
        r#"{"users":["macro|owner@example.com","macro|contact@example.com"]}"#,
    )
    .unwrap();

    assert!(matches!(message, ContactsMessage::Nodes(_)));
}

#[test]
fn consumer_rejects_message_with_both_shapes() {
    let message = serde_json::from_str::<ContactsMessage>(
        r#"{"users":["macro|owner@example.com"],"connections":[]}"#,
    );

    assert!(message.is_err());
}

#[test]
fn consumer_deserializes_explicit_connections_message() {
    let message: ContactsMessage = serde_json::from_str(
        r#"{"connections":[{"first":"macro|owner@example.com","second":"macro|contact@example.com"}]}"#,
    )
    .unwrap();

    assert!(matches!(message, ContactsMessage::Connections(_)));
}

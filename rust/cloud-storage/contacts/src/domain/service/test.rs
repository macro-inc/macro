use super::*;
use model::contacts::Message;
use std::collections::HashSet;

fn message_from_json(body: &str) -> Option<Message> {
    serde_json::from_str(body).ok()
}

fn connections_message_from_message(msg: Message) -> Option<ConnectionsMessage> {
    match msg {
        Message::AddConnection(con) => Some(con),
        _ => None,
    }
}

#[test]
fn test_deserialize_connections_message() {
    let input_json = include_str!("../../../tests/fixtures/add_connection.json");

    let message: Message = message_from_json(input_json).unwrap();
    let conn_msg = connections_message_from_message(message);
    assert!(conn_msg.is_some());
}

fn generate_sqs_message() -> aws_sdk_sqs::types::Message {
    let input_json = include_str!("../../../tests/fixtures/add_connection.json");
    aws_sdk_sqs::types::Message::builder()
        .set_body(Some(input_json.to_string()))
        .build()
}

#[tokio::test]
async fn test_message_from_aws_sqs() {
    let sqs_message = generate_sqs_message();
    let message = crate::inbound::worker::message_from_sqs(&sqs_message);

    assert!(message.is_some(), "Could not parse body from sqs message");

    let conn_msg = connections_message_from_message(message.unwrap());
    assert!(conn_msg.is_some());
}

#[tokio::test]
async fn test_add_user_to_group() {
    let group: Vec<String> = [
        "ff038d36-1aef-461a-8aa8-34001fa1abad",
        "5ab8c770-f2cb-4c6c-bc08-ae64569e324c",
        "d44caada-98c0-49eb-ab20-6851b824983a",
        "79a5557b-7827-4e2e-a6ae-f0935cdb762e",
        "c3f4d826-f8fd-478a-aa66-b5b6bb370cbc",
        "c3b1970f-18ee-4dfa-b5fb-e8240e28e51d",
        "9effe035-bb12-4fcc-b479-800e1c2551a8",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    let new_user = "ae2c090c-e478-4454-a001-3df458bf1fe4";

    let msg = add_user_to_group(&group, new_user).await;

    let msg: Message = serde_json::from_str(&msg).expect("could not parse JSON");

    let body = match msg {
        Message::AddConnection(body) => Some(body),
        _ => None,
    };

    assert!(body.is_some());

    let body = body.unwrap();

    assert_eq!(body.connections.len(), group.len());
}

#[tokio::test]
async fn test_user_already_in_group() {
    let group: Vec<String> = [
        "ff038d36-1aef-461a-8aa8-34001fa1abad",
        "5ab8c770-f2cb-4c6c-bc08-ae64569e324c",
        "d44caada-98c0-49eb-ab20-6851b824983a",
        "79a5557b-7827-4e2e-a6ae-f0935cdb762e",
        "c3f4d826-f8fd-478a-aa66-b5b6bb370cbc",
        "c3b1970f-18ee-4dfa-b5fb-e8240e28e51d",
        "9effe035-bb12-4fcc-b479-800e1c2551a8",
        "ae2c090c-e478-4454-a001-3df458bf1fe4",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    let new_user = "ae2c090c-e478-4454-a001-3df458bf1fe4";

    let msg = add_user_to_group(&group, new_user).await;

    let msg: Message = serde_json::from_str(&msg).expect("could not parse JSON");

    let body = match msg {
        Message::AddConnection(body) => Some(body),
        _ => None,
    };

    assert!(body.is_some());

    let body = body.unwrap();

    assert_eq!(body.connections.len(), 0);
}

#[tokio::test]
async fn test_add_participants_message_body() {
    let group = ["paul", "john", "ringo", "george"];
    let participants = ["ringo", "george"];

    // one participant to group of 4 (including self): 3 new connections
    // two new participants: 3 new connections, plus 2
    // (make sure to account for redundant connection)
    let expected_nconnections = 5;

    let body = AddParticipantsMessageBody {
        group: group.into_iter().map(String::from).collect(),
        participants: participants.into_iter().map(String::from).collect(),
        group_id: None,
    };

    let connections = add_participants(&body).await;

    assert_eq!(connections.len(), expected_nconnections);
}

#[tokio::test]
async fn test_create_group_message_body() {
    let group = ["paul", "john", "ringo", "george"];
    let n = group.len();

    let expected_nconnections = n * (n - 1) / 2;

    let body = CreateGroupMessageBody {
        group: group.into_iter().map(String::from).collect(),
        group_id: None,
    };

    let connections = create_group(&body).await;

    assert_eq!(connections.len(), expected_nconnections);
}

#[tokio::test]
async fn test_add_participants_lowercase() {
    let full_group = [
        "macro|paul@macro.com",
        "macro|john@macro.com",
        "macro|ringo@macro.com",
        "macro|george@macro.com",
    ];
    let new_participants = ["macro|Ringo@macro.com", "macro|George@macro.com"];

    let body = AddParticipantsMessageBody {
        group: full_group.into_iter().map(String::from).collect(),
        participants: new_participants.into_iter().map(String::from).collect(),
        group_id: None,
    };

    let expected_nconnections = 5;

    let connections = add_participants(&body).await;
    assert_eq!(connections.len(), expected_nconnections);
}

#[tokio::test]
async fn test_create_group_lowercase() {
    let group = [
        "macro|Paul@macro.com",
        "macro|john@macro.com",
        "macro|Ringo@macro.com",
        "macro|george@macro.com",
    ];

    let body = CreateGroupMessageBody {
        group: group.into_iter().map(String::from).collect(),
        group_id: None,
    };

    let connections = create_group(&body).await;

    let expected: HashSet<String> = [
        "macro|paul@macro.com",
        "macro|john@macro.com",
        "macro|ringo@macro.com",
        "macro|george@macro.com",
    ]
    .to_vec()
    .into_iter()
    .map(|s| s.to_string())
    .collect();

    let mut reality: HashSet<String> = HashSet::new();

    for con in connections {
        reality.insert(con.0);
        reality.insert(con.1);
    }

    let reality: HashSet<String> = reality.into_iter().collect();

    assert_eq!(expected, reality);
}

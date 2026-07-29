use super::*;
use crate::domain::models::messages::ContactConnection;
use std::sync::Mutex;

#[derive(Default)]
struct RecordingRepository {
    connections: Mutex<Vec<(MacroUserIdStr<'static>, MacroUserIdStr<'static>)>>,
}

impl ContactsRepository for RecordingRepository {
    async fn get_contacts(
        &self,
        _user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        Ok(Vec::new())
    }

    async fn create_connections(
        &self,
        connections: Vec<(MacroUserIdStr<'_>, MacroUserIdStr<'_>)>,
    ) -> Result<(), rootcause::Report> {
        self.connections.lock().unwrap().extend(
            connections
                .into_iter()
                .map(|(first, second)| (first.into_owned(), second.into_owned())),
        );
        Ok(())
    }
}

struct NoopNotifier;

impl ContactsNotifier for NoopNotifier {
    async fn invalidate_contacts_for_users(
        &self,
        _user_ids: Vec<MacroUserIdStr<'_>>,
    ) -> Result<(), rootcause::Report> {
        Ok(())
    }
}

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

#[test]
fn test_deserialize_connections_message() {
    let input_json = include_str!("../../../tests/fixtures/add_connection.json");
    let msg: Option<ContactsNodes> = serde_json::from_str(input_json).ok();
    assert!(msg.is_some());
    assert_eq!(msg.unwrap().users.len(), 3);
}

#[tokio::test]
async fn explicit_connections_do_not_create_a_complete_graph() {
    let owner = user("owner@example.com");
    let first = user("first@example.com");
    let second = user("second@example.com");
    let service = ContactsDomainService {
        repository: RecordingRepository::default(),
        notifier: NoopNotifier,
    };

    service
        .process_message(ContactsMessage::Connections(ContactConnections::new(vec![
            ContactConnection::new(owner.clone(), first.clone()),
            ContactConnection::new(owner.clone(), second.clone()),
        ])))
        .await
        .unwrap();

    let connections = service.repository.connections.lock().unwrap();
    assert_eq!(connections.len(), 2);
    assert!(connections.contains(&(owner.clone(), first.clone())));
    assert!(connections.contains(&(owner, second.clone())));
    assert!(!connections.contains(&(first.clone(), second.clone())));
    assert!(!connections.contains(&(second, first)));
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
    let Some(ContactsMessage::Nodes(message)) = message else {
        panic!("Could not parse body as a contacts-nodes message");
    };
    assert_eq!(message.users.len(), 3);
}

use super::*;
use crate::domain::models::list::InboxProvider;
use crate::domain::models::messages::ContactConnection;
use std::sync::Mutex;
use uuid::Uuid;

type Pair = (MacroUserIdStr<'static>, MacroUserIdStr<'static>);

#[derive(Default)]
struct RecordingRepository {
    connections: Mutex<Vec<Pair>>,
    /// What `record_interactions` reports as added.
    interactions_added: Vec<Pair>,
    /// What `missing_profiles` reports as deleted accounts.
    missing: Vec<MacroUserIdStr<'static>>,
    /// The owners `delete_user_lists` reports as having lost the user.
    lost: Vec<MacroUserIdStr<'static>>,
    deleted_lists: Mutex<Vec<MacroUserIdStr<'static>>>,
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

impl ContactListRepository for RecordingRepository {
    async fn record_interactions(
        &self,
        _users: &[MacroUserIdStr<'static>],
        _peers: &[MacroUserIdStr<'static>],
    ) -> Result<Vec<(MacroUserIdStr<'static>, MacroUserIdStr<'static>)>, rootcause::Report> {
        Ok(self.interactions_added.clone())
    }

    async fn record_inbox_contacts(
        &self,
        _inbox: &InboxSource,
        _contacts: &[MacroUserIdStr<'static>],
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        Ok(Vec::new())
    }

    async fn record_invite(
        &self,
        _owner: &MacroUserIdStr<'static>,
        _contact: &MacroUserIdStr<'static>,
    ) -> Result<bool, rootcause::Report> {
        Ok(false)
    }

    async fn missing_profiles(
        &self,
        ids: &[MacroUserIdStr<'static>],
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        Ok(self
            .missing
            .iter()
            .filter(|id| ids.contains(id))
            .cloned()
            .collect())
    }

    async fn delete_user_lists(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        self.deleted_lists.lock().unwrap().push(user.clone());
        Ok(self.lost.clone())
    }
}

struct NoopNotifier;

impl ContactsNotifier for NoopNotifier {
    async fn invalidate_contacts_for_users(
        &self,
        _invalidations: Vec<ContactsInvalidation>,
    ) -> Result<(), rootcause::Report> {
        Ok(())
    }
}

#[derive(Default)]
struct RecordingQueue {
    changes: Mutex<Vec<DirectoryChange>>,
}

impl ContactsIngressQueue for RecordingQueue {
    async fn publish_nodes(&self, _message: ContactsNodes) -> Result<(), rootcause::Report> {
        Ok(())
    }

    async fn publish_connections(
        &self,
        _message: ContactConnections,
    ) -> Result<(), rootcause::Report> {
        Ok(())
    }

    async fn publish_change(&self, message: DirectoryChange) -> Result<(), rootcause::Report> {
        self.changes.lock().unwrap().push(message);
        Ok(())
    }
}

fn users(prefix: &str, count: usize) -> Vec<MacroUserIdStr<'static>> {
    (0..count)
        .map(|i| user(&format!("{prefix}{i}@example.com")))
        .collect()
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

#[tokio::test]
async fn interactions_are_split_into_bounded_messages_covering_every_pair() {
    let ingress = SqsContactsIngress {
        queue: RecordingQueue::default(),
    };
    let members = users("user", 25);
    let peers = users("peer", 1001);

    ingress
        .record_interactions(members.clone(), peers.clone())
        .await
        .unwrap();

    let changes = ingress.queue.changes.lock().unwrap();
    assert_eq!(changes.len(), 9);
    let mut pairs = HashSet::new();
    for change in changes.iter() {
        let DirectoryChange::Interacted { users, peers } = change else {
            panic!("expected an interactions message, got {change:?}");
        };
        assert!(users.len() <= 10 && peers.len() <= 500);
        for user in users {
            for peer in peers {
                pairs.insert((user.clone(), peer.clone()));
            }
        }
    }
    assert_eq!(pairs.len(), members.len() * peers.len());
}

#[tokio::test]
async fn inbox_contacts_are_split_into_messages_of_500() {
    let ingress = SqsContactsIngress {
        queue: RecordingQueue::default(),
    };
    let inbox = InboxSource {
        owner: user("owner@example.com"),
        link_id: Uuid::nil(),
        provider: InboxProvider::Outlook,
    };

    ingress
        .record_inbox_contacts(inbox.clone(), users("contact", 1001))
        .await
        .unwrap();

    let sizes: Vec<_> = ingress
        .queue
        .changes
        .lock()
        .unwrap()
        .iter()
        .map(|change| match change {
            DirectoryChange::InboxContacts {
                inbox: source,
                contacts,
            } if *source == inbox => contacts.len(),
            other => panic!("expected inbox contacts, got {other:?}"),
        })
        .collect();
    assert_eq!(sizes, [500, 500, 1]);
}

#[tokio::test]
async fn directory_changes_beyond_one_lookup_are_sent_as_unknown() {
    let ingress = SqsContactsIngress {
        queue: RecordingQueue::default(),
    };

    ingress
        .directory_changed(users("member", 2), users("joiner", 501))
        .await
        .unwrap();

    assert_eq!(
        *ingress.queue.changes.lock().unwrap(),
        [DirectoryChange::Changed {
            users: users("member", 2),
            changed: Vec::new(),
        }]
    );
}

#[derive(Default)]
struct RecordingNotifier {
    invalidations: Mutex<Vec<ContactsInvalidation>>,
}

impl ContactsNotifier for RecordingNotifier {
    async fn invalidate_contacts_for_users(
        &self,
        invalidations: Vec<ContactsInvalidation>,
    ) -> Result<(), rootcause::Report> {
        self.invalidations.lock().unwrap().extend(invalidations);
        Ok(())
    }
}

/// Runs a legacy message and returns each notified user's changed contacts.
async fn notified(message: ContactsMessage) -> Vec<(String, Option<Vec<String>>)> {
    let service = ContactsDomainService {
        repository: RecordingRepository::default(),
        notifier: RecordingNotifier::default(),
    };
    service.process_message(message).await.unwrap();

    let mut notified: Vec<_> = service
        .notifier
        .invalidations
        .lock()
        .unwrap()
        .iter()
        .map(|invalidation| {
            let changed = invalidation
                .changed()
                .map(|changed| changed.iter().map(|id| id.as_ref().to_owned()).collect());
            (invalidation.user().as_ref().to_owned(), changed)
        })
        .collect();
    notified.sort();
    notified
}

#[tokio::test]
async fn a_complete_graph_tells_each_user_about_everyone_else() {
    let notified = notified(ContactsMessage::Nodes(ContactsNodes {
        users: HashSet::from([
            user("first@example.com"),
            user("second@example.com"),
            user("third@example.com"),
        ]),
    }))
    .await;

    assert_eq!(
        notified,
        [
            (
                "macro|first@example.com".to_owned(),
                Some(vec![
                    "macro|second@example.com".to_owned(),
                    "macro|third@example.com".to_owned(),
                ]),
            ),
            (
                "macro|second@example.com".to_owned(),
                Some(vec![
                    "macro|first@example.com".to_owned(),
                    "macro|third@example.com".to_owned(),
                ]),
            ),
            (
                "macro|third@example.com".to_owned(),
                Some(vec![
                    "macro|first@example.com".to_owned(),
                    "macro|second@example.com".to_owned(),
                ]),
            ),
        ]
    );
}

#[tokio::test]
async fn explicit_connections_tell_each_end_only_about_the_other() {
    let owner = user("owner@example.com");
    let notified = notified(ContactsMessage::Connections(ContactConnections::new(vec![
        ContactConnection::new(owner.clone(), user("second@example.com")),
        ContactConnection::new(owner.clone(), user("first@example.com")),
        ContactConnection::new(user("first@example.com"), owner.clone()),
        ContactConnection::new(owner.clone(), owner),
    ])))
    .await;

    assert_eq!(
        notified,
        [
            (
                "macro|first@example.com".to_owned(),
                Some(vec!["macro|owner@example.com".to_owned()]),
            ),
            (
                "macro|owner@example.com".to_owned(),
                Some(vec![
                    "macro|first@example.com".to_owned(),
                    "macro|second@example.com".to_owned(),
                ]),
            ),
            (
                "macro|second@example.com".to_owned(),
                Some(vec!["macro|owner@example.com".to_owned()]),
            ),
        ]
    );
}

#[tokio::test]
async fn a_user_connected_to_more_than_one_lookup_is_told_the_change_is_unknown() {
    let owner = user("owner@example.com");
    let connections = (0..=MAX_CHANGED_CONTACTS)
        .map(|i| ContactConnection::new(owner.clone(), user(&format!("peer{i}@example.com"))))
        .collect();

    let notified = notified(ContactsMessage::Connections(ContactConnections::new(
        connections,
    )))
    .await;

    let owner_changed = notified
        .iter()
        .find(|(user, _)| user == "macro|owner@example.com")
        .map(|(_, changed)| changed.clone());
    assert_eq!(owner_changed, Some(None));
    assert!(notified.iter().all(|(user, changed)| {
        user == "macro|owner@example.com"
            || changed.as_deref() == Some(&["macro|owner@example.com".to_owned()][..])
    }));
}

#[tokio::test]
async fn an_account_deleted_while_its_interaction_was_written_is_removed_again() {
    let (a, b, c) = (
        user("a@example.com"),
        user("b@example.com"),
        user("c@example.com"),
    );
    // The insert added a, b and c to each other, but b's profile was deleted
    // and its lists dropped before the insert committed.
    let service = ContactsDomainService {
        repository: RecordingRepository {
            interactions_added: vec![
                (a.clone(), b.clone()),
                (b.clone(), a.clone()),
                (a.clone(), c.clone()),
                (c.clone(), a.clone()),
                (b.clone(), c.clone()),
                (c.clone(), b.clone()),
            ],
            missing: vec![b.clone()],
            lost: vec![a.clone(), c.clone()],
            ..Default::default()
        },
        notifier: RecordingNotifier::default(),
    };

    service
        .process_message(ContactsMessage::Change(DirectoryChange::Interacted {
            users: vec![a.clone(), b.clone(), c.clone()],
            peers: vec![a.clone(), b.clone(), c.clone()],
        }))
        .await
        .unwrap();

    assert_eq!(*service.repository.deleted_lists.lock().unwrap(), [b]);
    let mut notified: Vec<_> = service
        .notifier
        .invalidations
        .lock()
        .unwrap()
        .iter()
        .map(|invalidation| {
            (
                invalidation.user().to_string(),
                invalidation.changed().is_none(),
            )
        })
        .collect();
    notified.sort();
    // a and c lost b, so they re-read everything rather than only each other.
    assert_eq!(notified, [(a.to_string(), true), (c.to_string(), true)]);
}

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use models_soup::{document::SoupDocument, item::SoupItem};
use uuid::Uuid;

use super::*;
use crate::domain::ports::{
    SoupItemReader, SoupRealtimeConsumer, SoupRealtimePublisher, UserAccessExpander,
};

const DOCUMENT_ID: &str = "00000000-0000-0000-0000-000000000001";
const OTHER_DOCUMENT_ID: &str = "00000000-0000-0000-0000-000000000002";

struct FakeAccessExpander {
    users: Vec<MacroUserIdStr<'static>>,
    fail: bool,
    calls: Arc<AtomicUsize>,
}

impl UserAccessExpander for FakeAccessExpander {
    async fn expand_user_access(
        &self,
        _entity: &Entity<'static>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail {
            Err(rootcause::report!("access unavailable"))
        } else {
            Ok(self.users.clone())
        }
    }
}

enum ReadResponse {
    Item(Box<SoupItem<()>>),
    Missing,
    Failure,
}

struct FakeReader {
    responses: Mutex<HashMap<String, ReadResponse>>,
    calls: Arc<AtomicUsize>,
}

impl SoupItemReader for FakeReader {
    async fn read_for_user(
        &self,
        user_id: MacroUserIdStr<'static>,
        _entity: &Entity<'static>,
    ) -> Result<Option<SoupItem<()>>, Report> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        match self
            .responses
            .lock()
            .expect("responses lock")
            .remove(user_id.as_ref())
            .unwrap_or(ReadResponse::Missing)
        {
            ReadResponse::Item(item) => Ok(Some(*item)),
            ReadResponse::Missing => Ok(None),
            ReadResponse::Failure => Err(rootcause::report!("reader unavailable")),
        }
    }
}

struct FakeRealtimeConsumer {
    messages: Mutex<VecDeque<Result<SoupRealtimeMessage, Report>>>,
    calls: Arc<AtomicUsize>,
}

impl SoupRealtimeConsumer for FakeRealtimeConsumer {
    async fn recv(&self) -> Result<SoupRealtimeMessage, Report> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.messages
            .lock()
            .expect("consumer messages lock")
            .pop_front()
            .unwrap_or_else(|| Err(rootcause::report!("consumer stopped")))
    }
}

struct FakePublisher {
    messages: Arc<Mutex<Vec<SoupRealtimeMessage>>>,
    fail_users: HashSet<String>,
}

impl SoupRealtimePublisher for FakePublisher {
    async fn publish(&self, message: SoupRealtimeMessage) -> Result<(), Report> {
        let should_fail = self.fail_users.contains(message.user_id.as_ref());
        self.messages.lock().expect("messages lock").push(message);
        if should_fail {
            Err(rootcause::report!("publisher unavailable"))
        } else {
            Ok(())
        }
    }
}

struct Harness {
    service: SoupRealtimeServiceImpl<FakeAccessExpander, FakeReader, FakePublisher>,
    access_calls: Arc<AtomicUsize>,
    read_calls: Arc<AtomicUsize>,
    messages: Arc<Mutex<Vec<SoupRealtimeMessage>>>,
}

fn user(local: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{local}@example.com")).expect("valid user id")
}

fn timestamp(seconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(seconds, 0).expect("valid timestamp")
}

fn document_item(id: &str, name: &str, viewed_at: Option<DateTime<Utc>>) -> SoupItem<()> {
    SoupItem::Document(SoupDocument {
        id: Uuid::parse_str(id).expect("valid document id"),
        document_version_id: 42,
        owner_id: user("owner"),
        name: name.to_string(),
        file_type: Some("md".to_string()),
        sha: Some("document-sha".to_string()),
        project_id: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        created_at: timestamp(1),
        updated_at: timestamp(2),
        viewed_at,
        sub_type: None,
        deleted_at: None,
        extra: (),
    })
}

fn document_entity() -> Entity<'static> {
    EntityType::Document.with_entity_string(DOCUMENT_ID.to_string())
}

fn document_name(item: &SoupItem<()>) -> &str {
    let SoupItem::Document(document) = item else {
        panic!("expected document item")
    };
    &document.name
}

fn harness(
    users: Vec<MacroUserIdStr<'static>>,
    responses: HashMap<String, ReadResponse>,
    access_fails: bool,
    fail_users: HashSet<String>,
) -> Harness {
    let access_calls = Arc::new(AtomicUsize::new(0));
    let read_calls = Arc::new(AtomicUsize::new(0));
    let messages = Arc::new(Mutex::new(Vec::new()));
    let service = SoupRealtimeServiceImpl::new(
        FakeAccessExpander {
            users,
            fail: access_fails,
            calls: access_calls.clone(),
        },
        FakeReader {
            responses: Mutex::new(responses),
            calls: read_calls.clone(),
        },
        FakePublisher {
            messages: messages.clone(),
            fail_users,
        },
    );
    Harness {
        service,
        access_calls,
        read_calls,
        messages,
    }
}

fn item_response(
    recipient: &MacroUserIdStr<'static>,
    item: SoupItem<()>,
) -> (String, ReadResponse) {
    (
        recipient.as_ref().to_string(),
        ReadResponse::Item(Box::new(item)),
    )
}

#[tokio::test(start_paused = true)]
async fn consumer_service_distributes_items_only_to_their_users() {
    let one = user("one");
    let two = user("two");
    let receive_calls = Arc::new(AtomicUsize::new(0));
    let consumer = FakeRealtimeConsumer {
        messages: Mutex::new(VecDeque::from([
            Err(rootcause::report!("transient receive failure")),
            Ok(SoupRealtimeMessage::new(
                one.clone(),
                document_item(DOCUMENT_ID, "For one", None),
            )),
            Ok(SoupRealtimeMessage::new(
                two.clone(),
                document_item(OTHER_DOCUMENT_ID, "For two", None),
            )),
        ])),
        calls: Arc::clone(&receive_calls),
    };
    let service = Arc::new(SoupRealtimeConsumerService::new(consumer));
    let mut one_first = service.subscribe(one.clone());
    let mut one_second = service.subscribe(one);
    let mut two_receiver = service.subscribe(two);

    let run_error = tokio::spawn({
        let service = Arc::clone(&service);
        async move { service.run().await }
    })
    .await
    .expect("consumer task joins")
    .expect_err("fake consumer eventually stops");
    assert!(run_error.to_string().contains("failed to receive"));
    assert_eq!(
        receive_calls.load(Ordering::SeqCst),
        3 + MAX_RECEIVE_ATTEMPTS,
        "a successful message resets the receive retry strategy"
    );

    let one_first_item = tokio::time::timeout(Duration::from_secs(1), one_first.recv())
        .await
        .expect("first user subscription receives before timeout")
        .expect("first user subscription remains open");
    let one_second_item = tokio::time::timeout(Duration::from_secs(1), one_second.recv())
        .await
        .expect("second user subscription receives before timeout")
        .expect("second user subscription remains open");
    let two_item = tokio::time::timeout(Duration::from_secs(1), two_receiver.recv())
        .await
        .expect("other user subscription receives before timeout")
        .expect("other user subscription remains open");

    assert_eq!(document_name(&one_first_item), "For one");
    assert!(Arc::ptr_eq(&one_first_item, &one_second_item));
    assert_eq!(document_name(&two_item), "For two");
    assert!(matches!(
        one_first.try_recv(),
        Err(tokio::sync::mpsc::error::TryRecvError::Empty)
    ));
    assert!(matches!(
        two_receiver.try_recv(),
        Err(tokio::sync::mpsc::error::TryRecvError::Empty)
    ));
}

#[tokio::test]
async fn zero_users_skips_reads_and_publications() {
    let harness = harness(Vec::new(), HashMap::new(), false, HashSet::new());

    harness
        .service
        .notify_users(document_entity())
        .await
        .expect("zero recipients is successful");

    assert_eq!(harness.access_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.read_calls.load(Ordering::SeqCst), 0);
    assert!(harness.messages.lock().expect("messages lock").is_empty());
}

#[tokio::test]
async fn one_user_receives_one_full_message() {
    let recipient = user("one");
    let viewed_at = Some(timestamp(3));
    let responses = HashMap::from([item_response(
        &recipient,
        document_item(DOCUMENT_ID, "Full document", viewed_at),
    )]);
    let harness = harness(vec![recipient.clone()], responses, false, HashSet::new());

    harness
        .service
        .notify_users(document_entity())
        .await
        .expect("fan-out succeeds");

    let mut messages = harness.messages.lock().expect("messages lock");
    let message = messages.pop().expect("one message");
    assert!(messages.is_empty());
    assert_eq!(message.user_id, recipient);
    match message.item {
        SoupItem::Document(document) => {
            assert_eq!(document.name, "Full document");
            assert_eq!(document.document_version_id, 42);
            assert_eq!(document.sha.as_deref(), Some("document-sha"));
            assert_eq!(document.viewed_at, None);
        }
        _ => panic!("expected document item"),
    }
}

#[tokio::test]
async fn three_unique_users_receive_exactly_three_messages() {
    let users = [user("one"), user("two"), user("three")];
    let responses = users
        .iter()
        .map(|recipient| {
            item_response(
                recipient,
                document_item(DOCUMENT_ID, recipient.as_ref(), None),
            )
        })
        .collect();
    let harness = harness(users.to_vec(), responses, false, HashSet::new());

    harness
        .service
        .notify_users(document_entity())
        .await
        .expect("fan-out succeeds");

    assert_eq!(harness.read_calls.load(Ordering::SeqCst), 1);
    let messages = harness.messages.lock().expect("messages lock");
    assert_eq!(messages.len(), 3);
    let recipients: HashSet<_> = messages
        .iter()
        .map(|message| message.user_id.as_ref().to_string())
        .collect();
    assert_eq!(recipients.len(), 3);
    assert!(
        users
            .iter()
            .all(|recipient| recipients.contains(recipient.as_ref()))
    );
}

#[tokio::test]
async fn duplicate_accessors_are_deduplicated() {
    let one = user("one");
    let two = user("two");
    let responses = HashMap::from([
        item_response(&one, document_item(DOCUMENT_ID, "One", None)),
        item_response(&two, document_item(DOCUMENT_ID, "Two", None)),
    ]);
    let harness = harness(
        vec![one.clone(), two, one],
        responses,
        false,
        HashSet::new(),
    );

    harness
        .service
        .notify_users(document_entity())
        .await
        .expect("fan-out succeeds");

    assert_eq!(harness.read_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.messages.lock().expect("messages lock").len(), 2);
}

#[tokio::test]
async fn all_recipients_get_the_first_item_with_no_viewed_at() {
    let one = user("one");
    let two = user("two");
    let responses = HashMap::from([
        item_response(
            &one,
            document_item(DOCUMENT_ID, "Representative", Some(timestamp(10))),
        ),
        item_response(
            &two,
            document_item(DOCUMENT_ID, "Should not be read", Some(timestamp(20))),
        ),
    ]);
    let harness = harness(vec![one, two], responses, false, HashSet::new());

    harness
        .service
        .notify_users(document_entity())
        .await
        .expect("fan-out succeeds");

    assert_eq!(harness.read_calls.load(Ordering::SeqCst), 1);
    let messages = harness.messages.lock().expect("messages lock");
    assert_eq!(messages.len(), 2);
    for message in messages.iter() {
        let SoupItem::Document(document) = &message.item else {
            panic!("expected document item")
        };
        assert_eq!(document.name, "Representative");
        assert_eq!(document.viewed_at, None);
    }
}

#[tokio::test]
async fn access_failure_prevents_reads_and_publications() {
    let harness = harness(vec![user("one")], HashMap::new(), true, HashSet::new());

    harness
        .service
        .notify_users(document_entity())
        .await
        .expect_err("access failure propagates");

    assert_eq!(harness.read_calls.load(Ordering::SeqCst), 0);
    assert!(harness.messages.lock().expect("messages lock").is_empty());
}

#[tokio::test]
async fn missing_item_prevents_all_publication() {
    let recipient = user("one");
    let responses = HashMap::from([(recipient.as_ref().to_string(), ReadResponse::Missing)]);
    let harness = harness(vec![recipient], responses, false, HashSet::new());

    harness
        .service
        .notify_users(document_entity())
        .await
        .expect_err("missing item is an error");

    assert!(harness.messages.lock().expect("messages lock").is_empty());
}

#[tokio::test]
async fn mismatched_item_prevents_all_publication() {
    let recipient = user("one");
    let responses = HashMap::from([item_response(
        &recipient,
        document_item(OTHER_DOCUMENT_ID, "Wrong", None),
    )]);
    let harness = harness(vec![recipient], responses, false, HashSet::new());

    harness
        .service
        .notify_users(document_entity())
        .await
        .expect_err("mismatched item is an error");

    assert!(harness.messages.lock().expect("messages lock").is_empty());
}

#[tokio::test]
async fn representative_reader_failure_prevents_all_publication() {
    let one = user("one");
    let two = user("two");
    let responses = HashMap::from([(one.as_ref().to_string(), ReadResponse::Failure)]);
    let harness = harness(vec![one, two], responses, false, HashSet::new());

    harness
        .service
        .notify_users(document_entity())
        .await
        .expect_err("reader failure propagates");

    assert_eq!(harness.read_calls.load(Ordering::SeqCst), 1);
    assert!(harness.messages.lock().expect("messages lock").is_empty());
}

#[tokio::test]
async fn publisher_failure_is_returned_after_all_messages_are_attempted() {
    let users = [user("one"), user("two"), user("three")];
    let responses = users
        .iter()
        .map(|recipient| {
            item_response(
                recipient,
                document_item(DOCUMENT_ID, recipient.as_ref(), None),
            )
        })
        .collect();
    let harness = harness(
        users.to_vec(),
        responses,
        false,
        HashSet::from([users[1].as_ref().to_string()]),
    );

    harness
        .service
        .notify_users(document_entity())
        .await
        .expect_err("publication failure propagates");

    assert_eq!(harness.messages.lock().expect("messages lock").len(), 3);
}

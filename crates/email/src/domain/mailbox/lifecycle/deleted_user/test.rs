use super::*;
use std::collections::{BTreeMap, HashSet};
use std::sync::{Arc, Mutex};
use tracing::instrument::WithSubscriber;
use tracing_subscriber::{Layer, layer::SubscriberExt};

const FIRST: Uuid = Uuid::from_u128(3);
const SECOND: Uuid = Uuid::from_u128(1);
const THIRD: Uuid = Uuid::from_u128(2);

#[derive(Debug, thiserror::Error)]
enum Fault {
    #[error("lookup failed")]
    Lookup,
    #[error("queue failed")]
    Queue,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Call {
    List(String),
    Delete(Uuid, String),
}
#[derive(Default)]
struct Data {
    calls: Vec<Call>,
    links: Vec<Uuid>,
    fail_lookup: bool,
    fail_queue: HashSet<Uuid>,
}
#[derive(Clone)]
struct Fake(Arc<Mutex<Data>>);

impl InboxCredentialOwnerLookup for Fake {
    type Err = Fault;
    async fn by_credential_owner(&self, owner: &str) -> Result<Vec<Uuid>, Fault> {
        let mut data = self.0.lock().unwrap();
        data.calls.push(Call::List(owner.into()));
        if data.fail_lookup {
            Err(Fault::Lookup)
        } else {
            Ok(data.links.clone())
        }
    }
}
impl InboxDeletionQueue for Fake {
    type Err = Fault;
    async fn request_deletion(&self, link: Uuid, reason: DeletionReason) -> Result<(), Fault> {
        let mut data = self.0.lock().unwrap();
        data.calls.push(Call::Delete(link, reason.as_str().into()));
        if data.fail_queue.contains(&link) {
            Err(Fault::Queue)
        } else {
            Ok(())
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Event {
    level: String,
    fields: BTreeMap<String, String>,
}
#[derive(Clone, Default)]
struct Capture(Arc<Mutex<Vec<Event>>>);
#[derive(Default)]
struct Fields(BTreeMap<String, String>);
impl tracing::field::Visit for Fields {
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        self.0.insert(field.name().into(), value.into());
    }
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        self.0.insert(field.name().into(), format!("{value:?}"));
    }
}
impl<S: tracing::Subscriber> Layer<S> for Capture {
    fn on_event(&self, event: &tracing::Event<'_>, _: tracing_subscriber::layer::Context<'_, S>) {
        let mut fields = Fields::default();
        event.record(&mut fields);
        self.0.lock().unwrap().push(Event {
            level: event.metadata().level().to_string(),
            fields: fields.0,
        });
    }
}

async fn run(data: Data) -> (Result<(), UserInboxDeletionError>, Vec<Call>, Vec<Event>) {
    let fake = Fake(Arc::new(Mutex::new(data)));
    let service = InboxLifecycleService::new(fake.clone(), fake.clone());
    let capture = Capture::default();
    let result = service
        .request_user_deletion("credential-owner")
        .with_subscriber(tracing_subscriber::registry().with(capture.clone()))
        .await;
    let calls = fake.0.lock().unwrap().calls.clone();
    let events = capture.0.lock().unwrap().clone();
    (result, calls, events)
}

fn called() -> Event {
    Event {
        level: "INFO".into(),
        fields: BTreeMap::from([
            ("message".into(), "Delete user called".into()),
            ("user_id".into(), "credential-owner".into()),
        ]),
    }
}

#[tokio::test]
async fn no_links_is_a_successful_noop_after_the_user_log_and_lookup() {
    let (result, calls, events) = run(Data::default()).await;
    assert_eq!(result, Ok(()));
    assert_eq!(calls, [Call::List("credential-owner".into())]);
    assert_eq!(events, [called()]);
}

#[tokio::test]
async fn every_link_is_enqueued_in_the_original_order_with_user_deleted_reason() {
    let (result, calls, events) = run(Data {
        links: vec![FIRST, SECOND, THIRD],
        ..Data::default()
    })
    .await;
    assert_eq!(result, Ok(()));
    assert_eq!(
        calls,
        [
            Call::List("credential-owner".into()),
            Call::Delete(FIRST, "UserDeleted".into()),
            Call::Delete(SECOND, "UserDeleted".into()),
            Call::Delete(THIRD, "UserDeleted".into())
        ]
    );
    assert_eq!(events, [called()]);
}

#[tokio::test]
async fn a_query_failure_logs_the_original_error_and_enqueues_nothing() {
    let (result, calls, events) = run(Data {
        fail_lookup: true,
        links: vec![FIRST, SECOND],
        ..Data::default()
    })
    .await;
    assert_eq!(result, Err(UserInboxDeletionError::InboxLookupFailed));
    assert_eq!(calls, [Call::List("credential-owner".into())]);
    assert_eq!(
        events,
        [
            called(),
            Event {
                level: "ERROR".into(),
                fields: BTreeMap::from([
                    ("message".into(), "unable to fetch links".into()),
                    ("error".into(), "Lookup".into()),
                ])
            }
        ]
    );
}

#[tokio::test]
async fn first_later_and_all_queue_failures_are_logged_without_stopping_the_loop() {
    for failures in [vec![FIRST], vec![SECOND], vec![FIRST, SECOND, THIRD]] {
        let (result, calls, events) = run(Data {
            links: vec![FIRST, SECOND, THIRD],
            fail_queue: failures.iter().copied().collect(),
            ..Data::default()
        })
        .await;
        assert_eq!(result, Ok(()));
        assert_eq!(
            calls,
            [
                Call::List("credential-owner".into()),
                Call::Delete(FIRST, "UserDeleted".into()),
                Call::Delete(SECOND, "UserDeleted".into()),
                Call::Delete(THIRD, "UserDeleted".into())
            ]
        );
        let mut expected = vec![called()];
        for link in failures {
            expected.push(Event {
                level: "ERROR".into(),
                fields: BTreeMap::from([
                    (
                        "message".into(),
                        "Failed to enqueue delete notification".into(),
                    ),
                    ("error".into(), "Queue".into()),
                    ("link_id".into(), link.to_string()),
                ]),
            });
        }
        assert_eq!(events, expected);
    }
}

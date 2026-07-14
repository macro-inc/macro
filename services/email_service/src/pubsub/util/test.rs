use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use email::domain::events::{EmailMacroEvent, MessageDeletedMetadata};
use macro_event_broker::{
    BufferedBrokerConfig, BufferedMacroEventBroker, EventBrokerError, EventPublisher, MacroEvent,
    MacroEventBroker,
};
use macro_user_id::user_id::MacroUserIdStr;
use tokio::sync::Notify;
use uuid::Uuid;

use super::{build_notification_recipients, publish_email_event};

struct NotifyBlockedPublisher {
    started: Arc<Notify>,
    release: Arc<Notify>,
}

impl EventPublisher for NotifyBlockedPublisher {
    async fn publish(
        &self,
        _topic: &'static str,
        _key: &str,
        _payload: &[u8],
    ) -> Result<(), EventBrokerError> {
        self.started.notify_one();
        self.release.notified().await;
        Ok(())
    }
}

#[derive(Clone, Copy)]
enum BrokerRejection {
    QueueFull,
    QueueClosed,
}

struct RejectingBroker {
    rejection: BrokerRejection,
    calls: AtomicUsize,
}

impl RejectingBroker {
    fn new(rejection: BrokerRejection) -> Self {
        Self {
            rejection,
            calls: AtomicUsize::new(0),
        }
    }
}

impl MacroEventBroker for RejectingBroker {
    async fn send_event<E: MacroEvent + ?Sized>(&self, _event: &E) -> Result<(), EventBrokerError> {
        self.calls.fetch_add(1, Ordering::Relaxed);

        match self.rejection {
            BrokerRejection::QueueFull => Err(EventBrokerError::QueueFull { capacity: 1 }),
            BrokerRejection::QueueClosed => Err(EventBrokerError::QueueClosed),
        }
    }
}

fn id(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(s.to_string()).expect("valid macro user id")
}

fn email_event() -> EmailMacroEvent {
    EmailMacroEvent::message_deleted(MessageDeletedMetadata {
        link_id: Uuid::from_u128(1),
        owner: id("macro|owner@example.com"),
        message_id: Uuid::from_u128(2),
        provider_message_id: "provider-message-id".to_owned(),
        thread_id: Uuid::from_u128(3),
    })
}

#[tokio::test]
async fn buffered_publish_returns_after_enqueue_and_abandons_blocked_delivery_on_shutdown() {
    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let (broker, runtime) = BufferedMacroEventBroker::start(
        NotifyBlockedPublisher {
            started: Arc::clone(&started),
            release,
        },
        BufferedBrokerConfig {
            queue_capacity: 1,
            shutdown_timeout: Duration::ZERO,
        },
    );

    let publish_task = tokio::spawn(async move {
        publish_email_event(&broker, &email_event()).await;
    });
    started.notified().await;

    assert!(
        publish_task.is_finished(),
        "email helper waited for publisher acknowledgement"
    );
    publish_task.await.expect("publish task should complete");

    let report = runtime.shutdown().await;
    assert!(report.timed_out);
    assert_eq!(report.delivered, 0);
    assert_eq!(report.failed, 0);
    assert_eq!(report.abandoned, 1);
}

#[tokio::test]
async fn queue_rejections_do_not_fail_email_publishing() {
    for rejection in [BrokerRejection::QueueFull, BrokerRejection::QueueClosed] {
        let broker = RejectingBroker::new(rejection);

        publish_email_event(&broker, &email_event()).await;

        assert_eq!(broker.calls.load(Ordering::Relaxed), 1);
    }
}

#[test]
fn fans_out_to_owner_and_every_delegated_primary() {
    let owner = id("macro|shared@team.test");
    let primaries = vec![
        "macro|alice@team.test".to_string(),
        "macro|bob@team.test".to_string(),
    ];

    let recipients = build_notification_recipients(&owner, primaries);

    assert_eq!(recipients.len(), 3);
    assert!(recipients.contains(&owner));
    assert!(recipients.contains(&id("macro|alice@team.test")));
    assert!(recipients.contains(&id("macro|bob@team.test")));
}

#[test]
fn owner_only_when_no_delegates() {
    let owner = id("macro|solo@personal.test");
    let recipients = build_notification_recipients(&owner, vec![]);
    assert_eq!(recipients.len(), 1);
    assert!(recipients.contains(&owner));
}

#[test]
fn skips_primaries_that_fail_to_parse() {
    let owner = id("macro|shared@team.test");
    let primaries = vec![
        "not-a-macro-id".to_string(),
        "macro|ok@team.test".to_string(),
    ];

    let recipients = build_notification_recipients(&owner, primaries);

    assert_eq!(recipients.len(), 2);
    assert!(recipients.contains(&owner));
    assert!(recipients.contains(&id("macro|ok@team.test")));
}

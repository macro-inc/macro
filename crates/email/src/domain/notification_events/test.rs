use std::sync::Mutex;

use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use macro_event_topics::Topic as _;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;
use uuid::Uuid;

use super::*;
use crate::domain::events::{
    EmailEventOrigin, EmailMacroEvent, MessageReceivedMetadata, ThreadBackfilledMetadata,
    ThreadReadMetadata, ThreadsReindexReason, ThreadsReindexRequestedMetadata,
};

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@example.com".to_string()).expect("valid user id")
}

fn message_received(link_id: Uuid, is_spam_or_trash: bool) -> EmailMacroEvent {
    EmailMacroEvent::message_received(MessageReceivedMetadata {
        link_id,
        owner: owner(),
        message_id: Uuid::nil(),
        provider_message_id: "gmail-msg-1".to_string(),
        thread_id: Uuid::nil(),
        provider_thread_id: "gmail-thread-1".to_string(),
        is_new_thread: true,
        subject: None,
        from_email: None,
        from_name: None,
        to_emails: vec![],
        attachment_count: 0,
        is_spam_or_trash,
        received_at: None,
    })
}

fn thread_read(link_id: Uuid, thread_id: Uuid) -> EmailMacroEvent {
    EmailMacroEvent::thread_read(ThreadReadMetadata {
        link_id,
        owner: owner(),
        actor: None,
        thread_id,
        is_read: true,
        origin: EmailEventOrigin::UserAction,
    })
}

/// Records the topic, key and envelope of every event sent.
#[derive(Default)]
struct RecordingBroker {
    sent: Mutex<Vec<(&'static str, String, serde_json::Value)>>,
}

impl MacroEventBroker for RecordingBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.sent.lock().expect("lock").push((
            event.event().topic(),
            event.key().to_string(),
            serde_json::to_value(event.event()).expect("serializable"),
        ));
        Ok(tokio::spawn(async { Ok(()) }))
    }
}

#[test]
fn public_topic_is_declared() {
    assert_eq!(
        MacroEmailNotificationsTopic::TOPIC_STR,
        "macro.email_notifications"
    );
}

#[test]
fn internal_signals_and_spam_arrivals_are_not_public() {
    let link_id = Uuid::now_v7();
    let private = [
        EmailMacroEvent::thread_backfilled(ThreadBackfilledMetadata {
            link_id,
            owner: owner(),
            thread_id: Uuid::now_v7(),
        }),
        EmailMacroEvent::threads_reindex_requested(ThreadsReindexRequestedMetadata {
            link_id,
            owner: owner(),
            thread_ids: vec![Uuid::now_v7()],
            reason: ThreadsReindexReason::ContactsChanged,
        }),
        message_received(link_id, true),
    ];
    for event in &private {
        assert!(EmailNotificationMacroEvent::from_email_event(event).is_none());
    }
    assert!(
        EmailNotificationMacroEvent::from_email_event(&message_received(link_id, false)).is_some()
    );
}

#[test]
fn public_event_keeps_the_envelope_key_and_subject() {
    let link_id = Uuid::now_v7();
    let thread_id = Uuid::now_v7();
    let source = thread_read(link_id, thread_id);
    let public = EmailNotificationMacroEvent::from_email_event(&source).expect("public event");

    assert_eq!(public.key(), link_id.to_string());
    assert_eq!(public.event().topic(), "macro.email_notifications");
    assert_eq!(public.event().event_id, source.event().event_id);
    assert_eq!(
        public.event().event.subject(),
        EmailNotificationSubject::Thread(thread_id)
    );
    assert_eq!(public.event().event.owner(), &owner());
    assert_eq!(
        serde_json::to_value(public.event()).expect("serializable"),
        serde_json::to_value(source.event()).expect("serializable"),
    );
    assert_eq!(
        serde_json::to_value(&public.event().event).expect("serializable")["event_type"],
        json!("email.thread_read")
    );
}

#[tokio::test]
async fn send_email_event_publishes_public_events_to_both_topics() {
    let broker = RecordingBroker::default();
    let link_id = Uuid::now_v7();
    let event = thread_read(link_id, Uuid::now_v7());

    broker
        .send_email_event(&event)
        .expect("sent")
        .await
        .expect("acknowledged");

    let sent = broker.sent.lock().expect("lock");
    let topics: Vec<_> = sent.iter().map(|(topic, _, _)| *topic).collect();
    assert_eq!(topics, ["macro.email", "macro.email_notifications"]);
    assert!(sent.iter().all(|(_, key, _)| *key == link_id.to_string()));
    assert_eq!(sent[0].2, sent[1].2, "both topics carry the same envelope");
}

#[tokio::test]
async fn send_email_event_keeps_private_events_on_the_internal_topic() {
    let broker = RecordingBroker::default();
    broker
        .send_email_event(&message_received(Uuid::now_v7(), true))
        .expect("sent")
        .await
        .expect("acknowledged");

    let sent = broker.sent.lock().expect("lock");
    let topics: Vec<_> = sent.iter().map(|(topic, _, _)| *topic).collect();
    assert_eq!(topics, ["macro.email"]);
}

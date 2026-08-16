use std::collections::VecDeque;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use chrono::Utc;
use model_entity::EntityType;
use rootcause::Report;
use uuid::Uuid;

use super::*;
use crate::domain::events::ActivityWireRow;

struct FakeConsumer {
    messages: Mutex<VecDeque<Result<ActivityTopicEvent, Report>>>,
    calls: Arc<AtomicUsize>,
}

impl ActivityTopicEventConsumer for FakeConsumer {
    async fn recv(&self) -> Result<ActivityTopicEvent, Report> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.messages
            .lock()
            .expect("consumer messages lock")
            .pop_front()
            .unwrap_or_else(|| Err(rootcause::report!("consumer stopped")))
    }
}

fn user(local: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{local}@example.com")).expect("valid user ID")
}

fn wire_row(subject: &MacroUserIdStr<'static>, entity_id: &str) -> ActivityWireRow {
    ActivityWireRow {
        id: Uuid::new_v4(),
        actor_id: subject.as_ref().to_owned(),
        subject_id: subject.as_ref().to_owned(),
        entity_type: EntityType::Document,
        entity_id: entity_id.to_string(),
        action: "edited".to_string(),
        action_payload: None,
        occurred_at: Utc::now(),
    }
}

fn recorded(activities: Vec<ActivityWireRow>) -> ActivityTopicEvent {
    ActivityTopicEvent::Recorded { activities }
}

#[tokio::test(start_paused = true)]
async fn distributes_activities_to_subject_subscriptions() {
    let one = user("one");
    let two = user("two");
    let receive_calls = Arc::new(AtomicUsize::new(0));
    let consumer = FakeConsumer {
        messages: Mutex::new(VecDeque::from([
            Err(rootcause::report!("transient receive failure")),
            Ok(recorded(vec![
                wire_row(&one, "doc-1"),
                wire_row(&two, "doc-2"),
            ])),
        ])),
        calls: Arc::clone(&receive_calls),
    };
    let service = Arc::new(ActivityRealtimeConsumerService::new(consumer));
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
        2 + MAX_RECEIVE_ATTEMPTS,
        "a successful event resets the receive retry strategy"
    );
    let ActivitySubscriptionUpdate::Updated(one_first) =
        one_first.recv().await.expect("first subscriber receives")
    else {
        panic!("expected activity update");
    };
    let ActivitySubscriptionUpdate::Updated(one_second) =
        one_second.recv().await.expect("second subscriber receives")
    else {
        panic!("expected activity update");
    };
    let ActivitySubscriptionUpdate::Updated(two) =
        two_receiver.recv().await.expect("other user receives")
    else {
        panic!("expected activity update");
    };
    assert_eq!(one_first.entity_id, "doc-1");
    assert_eq!(two.entity_id, "doc-2");
    assert!(Arc::ptr_eq(&one_first, &one_second));
}

#[tokio::test(start_paused = true)]
async fn drops_rows_with_non_user_subjects() {
    let subscribed = user("subscribed");
    let mut bot_row = wire_row(&subscribed, "ignored");
    bot_row.subject_id = "bot|automation".to_string();
    let consumer = FakeConsumer {
        messages: Mutex::new(VecDeque::from([Ok(recorded(vec![
            bot_row,
            wire_row(&subscribed, "doc-1"),
        ]))])),
        calls: Arc::new(AtomicUsize::new(0)),
    };
    let service = Arc::new(ActivityRealtimeConsumerService::new(consumer));
    let mut receiver = service.subscribe(subscribed);

    let _ = tokio::spawn({
        let service = Arc::clone(&service);
        async move { service.run().await }
    })
    .await
    .expect("consumer task joins")
    .expect_err("fake consumer eventually stops");

    // The bot row preceded doc-1 in the event, so the first delivery being
    // doc-1 proves the bot-subject row was dropped rather than forwarded.
    let ActivitySubscriptionUpdate::Updated(record) =
        receiver.recv().await.expect("subscriber receives")
    else {
        panic!("expected activity update");
    };
    assert_eq!(record.entity_id, "doc-1");
}

#[tokio::test(start_paused = true)]
async fn reports_slow_consumer_subscription_exit() {
    let subscribed = user("subscribed");
    let consumer = FakeConsumer {
        messages: Mutex::new(VecDeque::new()),
        calls: Arc::new(AtomicUsize::new(0)),
    };
    let service = ActivityRealtimeConsumerService::new(consumer);
    let subscription = service.subscribe(subscribed.clone());

    for _ in 0..=SUBSCRIBER_BUFFER_CAPACITY.get() {
        let row = wire_row(&subscribed, "doc-1");
        let record = row.into_record().expect("decodes");
        service
            .broadcasts
            .publish(
                &subscribed,
                ActivitySubscriptionUpdate::Updated(Arc::new(record)),
            )
            .expect("subscriber remains until its buffer fills");
        tokio::task::yield_now().await;
    }

    assert_eq!(
        subscription.exit_reason().await,
        ActivitySubscriptionExit::SlowConsumer
    );
}

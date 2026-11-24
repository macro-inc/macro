use std::sync::{Arc, Mutex};

use activity::domain::timeline::TimelineActivity;
use chrono::DateTime;
use macro_event_broker::{EventBrokerError, MacroEventBroker};
use macro_user_id::{cowlike::CowLike as _, user_id::MacroUserIdStr};
use uuid::Uuid;

use super::*;
use crate::domain::timeline_updates::ChannelTimelineUpdate;

const CHANNEL: Uuid = Uuid::from_u128(100);

#[derive(Clone, Default)]
struct RecordingBroker {
    published: Arc<Mutex<Vec<(String, String, Vec<u8>)>>>,
}

impl MacroEventBroker for RecordingBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.published.lock().unwrap().push((
            event.topic().to_owned(),
            event.key().to_owned(),
            serde_json::to_vec(event.event())?,
        ));
        Ok(tokio::spawn(async { Ok(()) }))
    }
}

fn update() -> AddressedChannelTimelineUpdate {
    AddressedChannelTimelineUpdate {
        recipients: vec![MacroUserIdStr::parse_from_str("macro|a@example.com").unwrap()],
        update: ChannelTimelineUpdate::activity(
            CHANNEL,
            12,
            TimelineActivity {
                id: Uuid::from_u128(7),
                actor_id: "macro|author@example.com".into(),
                occurred_at: DateTime::from_timestamp(1_000, 0).unwrap(),
                action: "picture_changed".into(),
                payload: None,
            },
        ),
    }
}

#[tokio::test]
async fn updates_are_keyed_by_channel_and_decode_to_what_was_published() {
    let broker = RecordingBroker::default();
    BrokerChannelTimelinePublisher::new(broker.clone())
        .publish(&update())
        .unwrap();

    let published = broker.published.lock().unwrap();
    let [(topic, key, payload)] = published.as_slice() else {
        panic!("one record per update");
    };
    assert_eq!(topic, "macro.channel_timeline");
    assert_eq!(key, &CHANNEL.to_string());

    let wire: serde_json::Value = serde_json::from_slice(payload).unwrap();
    assert_eq!(wire["event_type"], "channel_timeline.updated");
    assert_eq!(wire["schema_version"], 1);
    assert_eq!(wire["metadata"]["update"]["seq"], 12);
    assert_eq!(wire["metadata"]["recipients"][0], "macro|a@example.com");

    let decoded = Event::<ChannelTimelineTopicEvent>::decode(payload).unwrap();
    let ChannelTimelineTopicEvent::Updated(decoded) = decoded.event;
    assert_eq!(decoded.update.channel_id, CHANNEL);
    assert_eq!(decoded.update.activities[0].id, Uuid::from_u128(7));
}

#[tokio::test]
async fn a_recipient_that_cannot_subscribe_does_not_drop_the_update() {
    let broker = RecordingBroker::default();
    BrokerChannelTimelinePublisher::new(broker.clone())
        .publish(&update())
        .unwrap();
    let published = broker.published.lock().unwrap();
    let mut wire: serde_json::Value = serde_json::from_slice(&published[0].2).unwrap();
    // As a writer that addressed every participant, bots included, would.
    wire["metadata"]["recipients"] = serde_json::json!([
        "bot|00000000-0000-0000-0000-00000000b07a",
        "macro|a@example.com",
    ]);

    let decoded =
        Event::<ChannelTimelineTopicEvent>::decode(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let ChannelTimelineTopicEvent::Updated(decoded) = decoded.event;
    assert_eq!(
        decoded.recipients,
        vec![MacroUserIdStr::parse_from_str("macro|a@example.com").unwrap()]
    );
}

/// Kafka's default: a larger record is refused, after `send_event` returned.
const BROKER_LIMIT: usize = 1_000_000;

/// Refuses records over `limit` bytes in the detached publish, as Kafka does.
#[derive(Clone)]
struct LimitedBroker {
    limit: usize,
    accepted: Arc<Mutex<Vec<serde_json::Value>>>,
    attempted: tokio::sync::mpsc::UnboundedSender<bool>,
}

impl MacroEventBroker for LimitedBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        let payload = serde_json::to_vec(event.event())?;
        let fits = payload.len() < self.limit;
        if fits {
            let wire = serde_json::from_slice(&payload)?;
            self.accepted.lock().unwrap().push(wire);
        }
        let attempted = self.attempted.clone();
        Ok(tokio::spawn(async move {
            attempted.send(fits).unwrap();
            fits.then_some(())
                .ok_or_else(|| EventBrokerError::Publish("MessageSizeTooLarge".to_owned()))
        }))
    }
}

/// Publish `update` to a broker accepting `limit` bytes and return what it
/// accepted once an attempt of every recipient's record succeeded.
async fn accepted(
    limit: usize,
    update: AddressedChannelTimelineUpdate,
    records: usize,
) -> Vec<serde_json::Value> {
    let (attempted, mut attempts) = tokio::sync::mpsc::unbounded_channel();
    let broker = LimitedBroker {
        limit,
        accepted: Arc::default(),
        attempted,
    };
    BrokerChannelTimelinePublisher::new(broker.clone())
        .publish(&update)
        .unwrap();
    let mut succeeded = 0;
    while succeeded < records {
        let fits = tokio::time::timeout(std::time::Duration::from_secs(5), attempts.recv())
            .await
            .expect("the update was dropped: no record the broker accepts was sent")
            .unwrap();
        succeeded += usize::from(fits);
    }
    let accepted = broker.accepted.lock().unwrap().clone();
    accepted
}

/// An update whose activity payload is `bytes` long.
fn update_of(bytes: usize) -> AddressedChannelTimelineUpdate {
    let mut update = update();
    update.update.activities[0].payload = Some(serde_json::json!({ "text": "x".repeat(bytes) }));
    update
}

#[tokio::test(start_paused = true)]
async fn an_update_too_large_for_a_record_becomes_a_hint_to_catch_up() {
    let accepted = accepted(BROKER_LIMIT, update_of(2 * BROKER_LIMIT), 1).await;
    let [wire] = accepted.as_slice() else {
        panic!("one record, got {}", accepted.len());
    };
    let update = &wire["metadata"]["update"];
    assert_eq!(update["truncated"], true);
    assert_eq!(update["channel_id"], CHANNEL.to_string());
    assert_eq!(update["seq"], 12);
    assert_eq!(update["messages"], serde_json::json!([]));
    assert_eq!(update["activities"], serde_json::json!([]));
    assert_eq!(
        wire["metadata"]["recipients"],
        serde_json::json!(["macro|a@example.com"])
    );
}

#[tokio::test(start_paused = true)]
async fn a_refused_record_is_replaced_by_a_hint_to_catch_up() {
    // A topic configured below the size this publisher assumes.
    let accepted = accepted(10_000, update_of(20_000), 1).await;
    assert_eq!(accepted.len(), 1);
    assert_eq!(accepted[0]["metadata"]["update"]["truncated"], true);
    assert_eq!(accepted[0]["metadata"]["update"]["seq"], 12);
}

#[tokio::test(start_paused = true)]
async fn a_large_audience_is_split_across_records_that_each_fit() {
    let recipients: Vec<_> = (0..30_000)
        .map(|index| {
            let id = format!("macro|person-{index:06}@a-company.example.com");
            MacroUserIdStr::parse_from_str(&id).unwrap().into_owned()
        })
        .collect();
    let mut update = update_of(400_000);
    update.recipients.clone_from(&recipients);
    let accepted = accepted(BROKER_LIMIT, update, 1).await;
    assert!(accepted.len() > 1);
    let mut reached = Vec::new();
    for wire in &accepted {
        assert!(wire.to_string().len() < BROKER_LIMIT);
        // The change itself fits beside each part of the audience.
        assert_eq!(wire["metadata"]["update"]["truncated"], false);
        assert_eq!(
            wire["metadata"]["update"]["activities"][0]["id"],
            Uuid::from_u128(7).to_string()
        );
        reached.extend(wire["metadata"]["recipients"].as_array().unwrap().clone());
    }
    let expected: Vec<_> = recipients
        .iter()
        .map(|user| serde_json::Value::from(user.as_ref()))
        .collect();
    assert_eq!(reached, expected, "every recipient once, in order");
}

#[tokio::test]
async fn a_record_written_before_truncation_decodes_as_complete() {
    let mut wire =
        serde_json::to_value(ChannelTimelineMacroEvent::updated(update()).event()).unwrap();
    wire["metadata"]["update"]
        .as_object_mut()
        .unwrap()
        .remove("truncated");
    let decoded =
        Event::<ChannelTimelineTopicEvent>::decode(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let ChannelTimelineTopicEvent::Updated(decoded) = decoded.event;
    assert_eq!(
        serde_json::to_value(decoded.update).unwrap()["truncated"],
        false
    );
}

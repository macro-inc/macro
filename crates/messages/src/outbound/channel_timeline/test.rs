use std::sync::{Arc, Mutex};

use activity::domain::timeline::TimelineActivity;
use chrono::DateTime;
use macro_event_broker::{EventBrokerError, MacroEventBroker};
use macro_user_id::user_id::MacroUserIdStr;
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

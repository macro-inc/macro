use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use macro_event_broker::{Event, EventBrokerError, MacroEvent};
use uuid::Uuid;

use super::*;
use crate::domain::events::ActivityTopicEvent;
use crate::domain::models::{Actor, CommonAction};

#[derive(Clone, Default)]
struct RecordingBroker {
    published: Arc<Mutex<Vec<(String, serde_json::Value)>>>,
}

impl RecordingBroker {
    fn recorded_events(&self) -> Vec<(String, ActivityTopicEvent)> {
        self.published
            .lock()
            .expect("published lock")
            .iter()
            .map(|(key, value)| {
                let event: Event<ActivityTopicEvent> =
                    serde_json::from_value(value.clone()).expect("decodes");
                (key.clone(), event.event)
            })
            .collect()
    }
}

impl MacroEventBroker for RecordingBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.published.lock().expect("published lock").push((
            event.key().to_string(),
            serde_json::to_value(event.event())?,
        ));
        Ok(tokio::spawn(async { Ok(()) }))
    }
}

struct FakeAudience {
    by_entity: HashMap<String, Vec<MacroUserIdStr<'static>>>,
}

impl ActivityAudienceExpander for FakeAudience {
    type Err = std::convert::Infallible;

    async fn entity_audience(
        &self,
        _entity_type: EntityType,
        entity_id: &str,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Self::Err> {
        Ok(self.by_entity.get(entity_id).cloned().unwrap_or_default())
    }
}

struct FailingAudience;

impl ActivityAudienceExpander for FailingAudience {
    type Err = std::io::Error;

    async fn entity_audience(
        &self,
        _entity_type: EntityType,
        _entity_id: &str,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Self::Err> {
        Err(std::io::Error::other("access lookup unavailable"))
    }
}

fn user(local: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{local}@example.com")).expect("valid user id")
}

fn edited(ordinal: u32, actor: Actor<'static>, entity_id: &str) -> Activity {
    Activity::common(
        Uuid::from_u128(7),
        ordinal,
        actor,
        None,
        EntityType::Document,
        entity_id,
        CommonAction::Edited,
        Utc::now(),
    )
}

fn rows_for<'a>(
    events: &'a [(String, ActivityTopicEvent)],
    recipient: &str,
) -> &'a [ActivityWireRow] {
    events
        .iter()
        .find_map(|(key, event)| {
            let ActivityTopicEvent::Recorded {
                recipient_id,
                activities,
            } = event;
            assert_eq!(recipient_id, key, "events are keyed by their recipient");
            (recipient_id == recipient).then_some(activities.as_slice())
        })
        .unwrap_or_else(|| panic!("no event addressed to {recipient}"))
}

#[tokio::test]
async fn delivers_to_the_subject_and_the_entity_audience() {
    let teo = user("teo");
    let watcher = user("watcher");
    let broker = RecordingBroker::default();
    let publisher = KafkaActivityRealtimePublisher::new(
        broker.clone(),
        FakeAudience {
            by_entity: HashMap::from([("doc-1".to_string(), vec![teo.clone(), watcher.clone()])]),
        },
    );

    let activities = [
        edited(0, Actor::new_from_user(teo.clone()), "doc-1"),
        edited(1, Actor::new_from_user(teo.clone()), "doc-2"),
    ];
    publisher.publish_recorded(&activities).await;

    let events = broker.recorded_events();
    assert_eq!(events.len(), 2, "one event per distinct recipient");
    // The subject receives both rows (doc-2 has no audience beyond them);
    // the watcher receives only the row for the entity they can access.
    assert_eq!(rows_for(&events, teo.as_ref()).len(), 2);
    let watcher_rows = rows_for(&events, watcher.as_ref());
    assert_eq!(watcher_rows.len(), 1);
    assert_eq!(watcher_rows[0].entity_id, "doc-1");
}

#[tokio::test]
async fn bot_subject_rows_reach_the_entity_audience_only() {
    let watcher = user("watcher");
    let bot = Actor::new_from_bot(bot_id::BotId::new_from_uuid(Uuid::from_u128(42)));
    let broker = RecordingBroker::default();
    let publisher = KafkaActivityRealtimePublisher::new(
        broker.clone(),
        FakeAudience {
            by_entity: HashMap::from([("doc-1".to_string(), vec![watcher.clone()])]),
        },
    );

    publisher.publish_recorded(&[edited(0, bot, "doc-1")]).await;

    let events = broker.recorded_events();
    assert_eq!(
        events.len(),
        1,
        "a bot subject is not an addressable recipient"
    );
    assert_eq!(rows_for(&events, watcher.as_ref()).len(), 1);
}

#[tokio::test]
async fn expansion_failure_degrades_to_subject_only_delivery() {
    let teo = user("teo");
    let broker = RecordingBroker::default();
    let publisher = KafkaActivityRealtimePublisher::new(broker.clone(), FailingAudience);

    publisher
        .publish_recorded(&[edited(0, Actor::new_from_user(teo.clone()), "doc-1")])
        .await;

    let events = broker.recorded_events();
    assert_eq!(events.len(), 1);
    assert_eq!(rows_for(&events, teo.as_ref()).len(), 1);
}

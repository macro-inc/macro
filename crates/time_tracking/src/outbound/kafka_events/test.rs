use std::sync::{Arc, Mutex};

use chrono::NaiveDate;
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use uuid::Uuid;

use super::*;
use crate::domain::{events::TimeEntryChange, models::TimeEntrySource};

#[derive(Clone, Default)]
struct RecordingBroker {
    published: Arc<Mutex<Vec<(String, String, serde_json::Value)>>>,
    refuse: bool,
}

impl MacroEventBroker for RecordingBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        if self.refuse {
            return Err(EventBrokerError::Publish("broker refused".to_string()));
        }
        self.published.lock().unwrap().push((
            event.topic().to_owned(),
            event.key().to_owned(),
            serde_json::to_value(event.event())?,
        ));
        Ok(tokio::spawn(async { Ok(()) }))
    }
}

fn change() -> TimeEntryChange {
    TimeEntryChange {
        entry_id: Uuid::from_u128(0x51),
        task_id: "00000000-0000-0000-0000-0000000000a1".to_string(),
        user_id: MacroUserIdStr::parse_from_str("macro|author@example.com")
            .unwrap()
            .into_owned(),
        minutes: 45,
        entry_date: NaiveDate::from_ymd_opt(2026, 11, 20).unwrap(),
        source: TimeEntrySource::Timer,
        total_minutes: 75,
    }
}

#[tokio::test]
async fn each_change_is_published_on_the_time_entries_topic_keyed_by_its_task() {
    let broker = RecordingBroker::default();
    let publisher = BrokerTimeEntryEventPublisher::new(broker.clone());

    publisher.publish(TimeEntryMacroEvent::logged(change()));
    publisher.publish(TimeEntryMacroEvent::updated(change()));
    publisher.publish(TimeEntryMacroEvent::deleted(change()));

    let published = broker.published.lock().unwrap().clone();
    let event_types: Vec<_> = published
        .iter()
        .map(|(topic, key, envelope)| {
            assert_eq!(topic, "macro.time_entries");
            assert_eq!(key, "00000000-0000-0000-0000-0000000000a1");
            envelope["event_type"].as_str().unwrap().to_string()
        })
        .collect();
    assert_eq!(
        event_types,
        vec![
            "time_entry.logged",
            "time_entry.updated",
            "time_entry.deleted"
        ]
    );

    let mut envelope = published[0].2.clone();
    let event_id = envelope.as_object_mut().unwrap().remove("event_id");
    assert!(event_id.is_some());
    assert_eq!(
        envelope,
        serde_json::json!({
            "schema_version": 1,
            "event_type": "time_entry.logged",
            "metadata": {
                "entry_id": "00000000-0000-0000-0000-000000000051",
                "task_id": "00000000-0000-0000-0000-0000000000a1",
                "user_id": "macro|author@example.com",
                "minutes": 45,
                "entry_date": "2026-11-20",
                "source": "timer",
                "total_minutes": 75
            }
        })
    );
}

#[tokio::test]
async fn a_broker_that_refuses_the_event_does_not_fail_the_write() {
    let publisher = BrokerTimeEntryEventPublisher::new(RecordingBroker {
        refuse: true,
        ..RecordingBroker::default()
    });

    publisher.publish(TimeEntryMacroEvent::logged(change()));
}

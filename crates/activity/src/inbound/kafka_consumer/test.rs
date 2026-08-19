use std::sync::{Arc, Mutex};

use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::*;
use crate::domain::events::ActivityMacroEvent;
use crate::domain::models::{Activity, Actor, CommonAction, EntityType};

macro_event_broker::declare_topics!(TestEvents: ActivityMacroEvent);

/// Records the relative order of storage writes and realtime announcements.
type CallLog = Arc<Mutex<Vec<&'static str>>>;

struct FakeRepo {
    log: CallLog,
    fail: bool,
}

#[derive(Debug)]
struct StorageDown;

impl std::fmt::Display for StorageDown {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("storage down")
    }
}

impl std::error::Error for StorageDown {}

impl ActivityRepo for FakeRepo {
    type Err = StorageDown;

    async fn insert_activities(&self, _activities: &[Activity]) -> Result<(), Self::Err> {
        if self.fail {
            return Err(StorageDown);
        }
        self.log.lock().expect("log lock").push("insert");
        Ok(())
    }

    async fn purge_entities(&self, _entities: &[(EntityType, String)]) -> Result<(), Self::Err> {
        self.log.lock().expect("log lock").push("purge");
        Ok(())
    }
}

struct FakePublisher {
    log: CallLog,
}

impl ActivityRealtimePublisher for FakePublisher {
    async fn publish_recorded(&self, _activities: &[Activity]) {
        self.log.lock().expect("log lock").push("publish");
    }
}

fn activity() -> Activity {
    Activity::common(
        Uuid::from_u128(7),
        0,
        Actor::new_from_user(
            MacroUserIdStr::try_from("macro|teo@example.com".to_string()).expect("valid user"),
        ),
        None,
        EntityType::Document,
        "doc-1",
        CommonAction::Edited,
        Utc::now(),
    )
}

fn event() -> TestEvents {
    TestEvents::ActivityMacroEvent(ActivityMacroEvent::recorded(
        "macro|teo@example.com",
        vec![],
    ))
}

#[tokio::test]
async fn announces_only_after_a_successful_insert() {
    let log: CallLog = Arc::default();
    let consumer = ActivityConsumer::<_, TestEvents, _, _>::new(
        FakeRepo {
            log: Arc::clone(&log),
            fail: false,
        },
        |_event: &TestEvents| Ingest::Insert(vec![activity()]),
        FakePublisher {
            log: Arc::clone(&log),
        },
    );

    consumer.apply(&event()).await.expect("insert succeeds");
    assert_eq!(*log.lock().expect("log lock"), vec!["insert", "publish"]);
}

#[tokio::test]
async fn does_not_announce_when_the_insert_fails() {
    let log: CallLog = Arc::default();
    let consumer = ActivityConsumer::<_, TestEvents, _, _>::new(
        FakeRepo {
            log: Arc::clone(&log),
            fail: true,
        },
        |_event: &TestEvents| Ingest::Insert(vec![activity()]),
        FakePublisher {
            log: Arc::clone(&log),
        },
    );

    consumer
        .apply(&event())
        .await
        .expect_err("storage failure propagates");
    assert!(log.lock().expect("log lock").is_empty());
}

#[tokio::test]
async fn ignores_and_purges_do_not_announce() {
    let log: CallLog = Arc::default();
    let consumer = ActivityConsumer::<_, TestEvents, _, _>::new(
        FakeRepo {
            log: Arc::clone(&log),
            fail: false,
        },
        |_event: &TestEvents| Ingest::Purge(vec![(EntityType::Document, "doc-1".to_string())]),
        FakePublisher {
            log: Arc::clone(&log),
        },
    );

    consumer.apply(&event()).await.expect("purge succeeds");
    assert_eq!(*log.lock().expect("log lock"), vec!["purge"]);
}

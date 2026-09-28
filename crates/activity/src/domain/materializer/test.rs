use std::sync::{Arc, Mutex};

use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::*;
use crate::domain::ports::ActivityRepo;

use crate::domain::models::{Activity, Actor, CommonAction, EntityType};

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
        if self.fail {
            return Err(StorageDown);
        }
        self.log.lock().expect("log lock").push("purge");
        Ok(())
    }
}

struct FakePublisher {
    log: CallLog,
}

impl ActivityRealtimePublisher for FakePublisher {
    async fn publish_invalidated(&self) {
        self.log.lock().expect("log lock").push("delete");
    }
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

#[tokio::test]
async fn announces_only_after_a_successful_insert() {
    let log: CallLog = Arc::default();
    let consumer = ActivityMaterializer::new(
        FakeRepo {
            log: Arc::clone(&log),
            fail: false,
        },
        FakePublisher {
            log: Arc::clone(&log),
        },
    );

    consumer
        .apply(Ingest::Insert(vec![activity()]))
        .await
        .expect("insert succeeds");
    assert_eq!(*log.lock().expect("log lock"), vec!["insert", "publish"]);
}

#[tokio::test]
async fn does_not_announce_when_the_insert_fails() {
    let log: CallLog = Arc::default();
    let consumer = ActivityMaterializer::new(
        FakeRepo {
            log: Arc::clone(&log),
            fail: true,
        },
        FakePublisher {
            log: Arc::clone(&log),
        },
    );

    consumer
        .apply(Ingest::Insert(vec![activity()]))
        .await
        .expect_err("storage failure propagates");
    assert!(log.lock().expect("log lock").is_empty());
}

#[tokio::test]
async fn announces_after_purge() {
    let log: CallLog = Arc::default();
    let consumer = ActivityMaterializer::new(
        FakeRepo {
            log: Arc::clone(&log),
            fail: false,
        },
        FakePublisher {
            log: Arc::clone(&log),
        },
    );

    consumer
        .apply(Ingest::Purge(vec![(
            EntityType::Document,
            "doc-1".to_string(),
        )]))
        .await
        .expect("purge succeeds");
    assert_eq!(*log.lock().expect("log lock"), vec!["purge", "delete"]);
}

#[tokio::test]
async fn replays_resend_purge_invalidation_and_empty_purges_do_nothing() {
    let log: CallLog = Arc::default();
    let materializer = ActivityMaterializer::new(
        FakeRepo {
            log: log.clone(),
            fail: false,
        },
        FakePublisher { log: log.clone() },
    );
    materializer.apply(Ingest::Ignore).await.unwrap();
    materializer.apply(Ingest::Purge(Vec::new())).await.unwrap();
    assert!(log.lock().unwrap().is_empty());
    for _ in 0..2 {
        materializer
            .apply(Ingest::Purge(vec![(
                EntityType::Document,
                "deleted-doc".into(),
            )]))
            .await
            .unwrap();
    }
    assert_eq!(
        *log.lock().unwrap(),
        vec!["purge", "delete", "purge", "delete"]
    );
}

#[tokio::test]
async fn failed_purges_do_not_announce() {
    let log: CallLog = Arc::default();
    let materializer = ActivityMaterializer::new(
        FakeRepo {
            log: log.clone(),
            fail: true,
        },
        FakePublisher { log: log.clone() },
    );
    materializer
        .apply(Ingest::Purge(vec![(EntityType::Document, "doc-1".into())]))
        .await
        .expect_err("storage failure");
    assert!(log.lock().unwrap().is_empty());
}

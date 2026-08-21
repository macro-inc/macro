use std::{
    collections::HashMap,
    convert::Infallible,
    num::NonZeroU32,
    sync::{Arc, Mutex},
};

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::*;
use crate::domain::{
    models::{Action, ActivityRecord, Actor, PropertyChange, RecordedAction},
    ports::{ActivityFeedPage, ActivityRange, EntityActivityMap},
};

#[derive(Clone)]
struct FakeReads {
    range: ActivityRange,
}

impl ActivityReads for FakeReads {
    type Err = Infallible;

    async fn subject_feed(
        &self,
        _subject_id: &str,
        _cursor: Option<(DateTime<Utc>, Uuid)>,
        _limit: NonZeroU32,
    ) -> Result<ActivityFeedPage, Self::Err> {
        unreachable!()
    }

    async fn entity_activity(
        &self,
        _keys: &[(crate::EntityType, String)],
        _per_entity_limit: u32,
    ) -> Result<EntityActivityMap, Self::Err> {
        unreachable!()
    }

    async fn subject_activity_range(
        &self,
        _subject_id: &str,
        _from: DateTime<Utc>,
        _to: DateTime<Utc>,
        _limit: NonZeroU32,
    ) -> Result<ActivityRange, Self::Err> {
        Ok(self.range.clone())
    }
}

#[derive(Clone)]
struct RecordingMetadata {
    requests: Arc<Mutex<Vec<Vec<String>>>>,
}

#[async_trait::async_trait]
impl ActivityMetadataResolver for RecordingMetadata {
    async fn resolve_properties(
        &self,
        _viewer: &MacroUserIdStr<'_>,
        property_ids: &[String],
    ) -> HashMap<String, ActivityPropertyMetadata> {
        self.requests.lock().unwrap().push(property_ids.to_vec());
        property_ids
            .iter()
            .map(|id| {
                (
                    id.clone(),
                    ActivityPropertyMetadata {
                        display_name: "Status".to_string(),
                        data_type: "select_string".to_string(),
                        option_labels: HashMap::new(),
                    },
                )
            })
            .collect()
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|user@example.com".to_string()).unwrap()
}

fn time(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .unwrap()
        .with_timezone(&Utc)
}

fn property_record(id: u128) -> ActivityRecord {
    ActivityRecord {
        id: Uuid::from_u128(id),
        actor: Actor::new_from_user(user()),
        subject_id: user().to_string(),
        entity_type: crate::EntityType::Document,
        entity_id: format!("doc-{id}"),
        action: RecordedAction::Known(Action::PropertyChanged(PropertyChange {
            property: "property-status".to_string(),
            from: None,
            to: None,
        })),
        occurred_at: time("2026-08-19T17:30:00Z"),
    }
}

#[tokio::test]
async fn resolves_each_referenced_property_once() {
    let requests = Arc::new(Mutex::new(Vec::new()));
    let service = ActivityReadService::new(FakeReads {
        range: ActivityRange {
            records: vec![property_record(1), property_record(2)],
            truncated: false,
        },
    })
    .with_metadata_resolver(RecordingMetadata {
        requests: Arc::clone(&requests),
    });

    let resolved = service
        .subject_activity_range(
            &user(),
            time("2026-08-19T16:00:00Z"),
            time("2026-08-19T18:00:00Z"),
            NonZeroU32::new(100).unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(
        resolved.properties["property-status"].display_name,
        "Status"
    );
    assert_eq!(
        requests.lock().unwrap().as_slice(),
        &[vec!["property-status".to_string()]]
    );
}

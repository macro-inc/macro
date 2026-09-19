use std::{
    collections::HashMap,
    fmt,
    num::NonZeroU32,
    sync::{Arc, Mutex},
};

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, schema::generate_validated_input_schema,
};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::*;
use crate::domain::{
    models::{Action, ActivityRecord, Actor, PropertyChange, RecordedAction},
    ports::{
        ActivityFeedPage, ActivityMetadataResolver, ActivityPropertyMetadata, ActivityRange,
        ActivityReads, EntityActivityMap,
    },
};

#[derive(Debug)]
struct FakeReadError;

impl fmt::Display for FakeReadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "fake activity read error")
    }
}

impl std::error::Error for FakeReadError {}

#[derive(Debug, Clone, PartialEq)]
struct RangeQuery {
    subject_id: String,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    limit: NonZeroU32,
}

#[derive(Clone)]
struct FakeReads {
    queries: Arc<Mutex<Vec<RangeQuery>>>,
    range: ActivityRange,
}

impl FakeReads {
    fn new(range: ActivityRange) -> Self {
        Self {
            queries: Arc::new(Mutex::new(Vec::new())),
            range,
        }
    }
}

impl ActivityReads for FakeReads {
    type Err = FakeReadError;

    async fn subject_feed(
        &self,
        _subject_id: &str,
        _cursor: Option<(DateTime<Utc>, Uuid)>,
        _limit: NonZeroU32,
    ) -> Result<ActivityFeedPage, Self::Err> {
        Ok(ActivityFeedPage {
            records: Vec::new(),
            next: None,
        })
    }

    async fn entity_activity(
        &self,
        _keys: &[(crate::EntityType, String)],
        _per_entity_limit: u32,
    ) -> Result<EntityActivityMap, Self::Err> {
        Ok(HashMap::new())
    }

    async fn subject_overview(
        &self,
        _subject_id: &str,
        window: crate::domain::overview::ActivityWindow,
    ) -> Result<crate::domain::overview::ActivityOverview, Self::Err> {
        Ok(crate::domain::overview::ActivityOverview::empty(window))
    }

    async fn subject_activity_range(
        &self,
        subject_id: &str,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
        limit: NonZeroU32,
    ) -> Result<ActivityRange, Self::Err> {
        self.queries.lock().unwrap().push(RangeQuery {
            subject_id: subject_id.to_string(),
            from,
            to,
            limit,
        });
        Ok(self.range.clone())
    }
}

fn time(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .unwrap()
        .with_timezone(&Utc)
}

fn user(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid user id")
}

fn record() -> ActivityRecord {
    ActivityRecord {
        id: Uuid::from_u128(1),
        actor: Actor::new_from_user(user("macro|agent@example.com")),
        subject_id: "macro|caller@example.com".to_string(),
        entity_type: crate::EntityType::Document,
        entity_id: "doc-1".to_string(),
        action: RecordedAction::Known(Action::Edited),
        occurred_at: time("2026-08-17T13:00:00Z"),
    }
}

#[derive(Clone, Copy)]
struct FakeMetadata;

#[async_trait::async_trait]
impl ActivityMetadataResolver for FakeMetadata {
    async fn resolve_properties(
        &self,
        _viewer: &MacroUserIdStr<'_>,
        property_ids: &[String],
    ) -> HashMap<String, ActivityPropertyMetadata> {
        property_ids
            .iter()
            .map(|id| {
                (
                    id.clone(),
                    ActivityPropertyMetadata {
                        display_name: "Status".to_string(),
                        data_type: "select_string".to_string(),
                        option_labels: HashMap::from([(
                            "00000000-0000-0000-0000-000000000001".to_string(),
                            "Completed".to_string(),
                        )]),
                    },
                )
            })
            .collect()
    }
}

#[test]
fn read_activity_schema_is_valid() {
    let validated = generate_validated_input_schema::<ReadActivity>().unwrap();
    assert_eq!(validated.name, "ReadActivity");
    assert!(validated.description.contains("authenticated user"));
}

#[tokio::test]
async fn reads_only_the_authenticated_users_activity_with_a_fixed_cap() {
    let from = time("2026-08-17T12:00:00Z");
    let to = time("2026-08-17T14:00:00Z");
    let reads = FakeReads::new(ActivityRange {
        records: vec![record()],
        truncated: true,
    });
    let queries = Arc::clone(&reads.queries);
    let tool = ReadActivity { from, to };

    let response = tool
        .call(
            ServiceContext(ActivityToolContext::new(reads)),
            RequestContext::new(user("macro|caller@example.com")),
        )
        .await
        .unwrap();

    assert_eq!(
        queries.lock().unwrap().as_slice(),
        &[RangeQuery {
            subject_id: "macro|caller@example.com".to_string(),
            from,
            to,
            limit: NonZeroU32::new(100).unwrap(),
        }]
    );
    assert!(response.truncated);
    assert_eq!(response.activities.len(), 1);
    assert_eq!(response.activities[0].actor_id, "macro|agent@example.com");
    assert_eq!(response.activities[0].entity_type, "document");
    assert_eq!(response.activities[0].entity_id, "doc-1");
    assert_eq!(response.activities[0].action, ToolActivityAction::Edited);
}

#[tokio::test]
async fn rejects_an_empty_or_reversed_range_before_reading() {
    let at = time("2026-08-17T12:00:00Z");
    let reads = FakeReads::new(ActivityRange {
        records: Vec::new(),
        truncated: false,
    });
    let queries = Arc::clone(&reads.queries);
    let tool = ReadActivity { from: at, to: at };

    let error = tool
        .call(
            ServiceContext(ActivityToolContext::new(reads)),
            RequestContext::new(user("macro|caller@example.com")),
        )
        .await
        .unwrap_err();

    assert_eq!(
        error.description,
        "activity range `from` must be before `to`"
    );
    assert!(queries.lock().unwrap().is_empty());
}

#[tokio::test]
async fn resolves_property_and_option_names_for_the_model() {
    let property = "00000000-0000-0000-0000-000000000002";
    let option = "00000000-0000-0000-0000-000000000001";
    let mut record = record();
    record.action = RecordedAction::Known(Action::PropertyChanged(PropertyChange {
        property: property.to_string(),
        from: None,
        to: Some(serde_json::json!({
            "type": "SelectOption",
            "value": [option],
        })),
    }));
    let reads = FakeReads::new(ActivityRange {
        records: vec![record],
        truncated: false,
    });

    let response = ReadActivity {
        from: time("2026-08-17T12:00:00Z"),
        to: time("2026-08-17T14:00:00Z"),
    }
    .call(
        ServiceContext(ActivityToolContext::new(reads).with_metadata_resolver(FakeMetadata)),
        RequestContext::new(user("macro|caller@example.com")),
    )
    .await
    .unwrap();

    assert_eq!(
        response.activities[0].action,
        ToolActivityAction::PropertyChanged {
            property: property.to_string(),
            property_name: Some("Status".to_string()),
            property_type: Some("select_string".to_string()),
            from: None,
            from_labels: None,
            to: Some(serde_json::json!({
                "type": "SelectOption",
                "value": [option],
            })),
            to_labels: Some(vec!["Completed".to_string()]),
        }
    );
}

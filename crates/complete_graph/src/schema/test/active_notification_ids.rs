use std::sync::{Arc, Mutex};

use graphql_notification::ActiveNotificationIdsGraphqlContext;
use notification::domain::active_notification_ids::{
    ActiveNotificationIdRepository, ActiveNotificationIdService, ActiveNotificationIdStorageError,
};

use super::*;

const NEWER: Uuid = Uuid::from_u128(0x2);
const OLDER: Uuid = Uuid::from_u128(0x1);

/// A read's user, event types and limit.
type Read = (String, Vec<String>, u32);

#[derive(Clone, Default)]
struct RecordingRepository {
    reads: Arc<Mutex<Vec<Read>>>,
}

impl ActiveNotificationIdRepository for RecordingRepository {
    async fn active_notification_ids(
        &self,
        user: MacroUserIdStr<'_>,
        event_types: &[String],
        limit: u32,
    ) -> Result<Vec<Uuid>, ActiveNotificationIdStorageError> {
        self.reads
            .lock()
            .unwrap()
            .push((user.to_string(), event_types.to_vec(), limit));
        Ok(vec![NEWER, OLDER])
    }
}

fn context(repository: &RecordingRepository) -> ActiveNotificationIdsGraphqlContext {
    ActiveNotificationIdsGraphqlContext::new(ActiveNotificationIdService::new(
        repository.clone(),
        model_notifications::NotifEvent::EVENT_TYPES,
    ))
}

#[tokio::test]
async fn reads_the_authenticated_viewers_ids_in_the_repository_order() {
    let harness = harness();
    let repository = RecordingRepository::default();
    let query = r#"{ user { id
        byDefault: activeNotificationIds(eventTypes: ["document_mention"])
        limited: activeNotificationIds(eventTypes: ["channel_mention", "document_mention"], limit: 2)
    } }"#;

    let signed_out = harness
        .schema
        .execute(
            harness
                .request(query, bearer_parts("invalid"))
                .data(context(&repository)),
        )
        .await;
    assert!(!signed_out.errors.is_empty());
    assert!(repository.reads.lock().unwrap().is_empty());

    let response = harness
        .schema
        .execute(
            harness
                .request(query, authenticated_parts())
                .data(context(&repository)),
        )
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let expected = serde_json::json!([NEWER.to_string(), OLDER.to_string()]);
    assert_eq!(data["user"]["byDefault"], expected);
    assert_eq!(data["user"]["limited"], expected);
    let mut reads = repository.reads.lock().unwrap().clone();
    reads.sort_by_key(|read| read.2);
    assert_eq!(
        reads,
        vec![
            (
                VALID_USER_ID.to_owned(),
                vec!["channel_mention".to_owned(), "document_mention".to_owned()],
                2,
            ),
            (
                VALID_USER_ID.to_owned(),
                vec!["document_mention".to_owned()],
                100,
            ),
        ]
    );
}

#[tokio::test]
async fn rejects_empty_unknown_and_out_of_range_reads_as_bad_input() {
    let harness = harness();
    let repository = RecordingRepository::default();

    for field in [
        "activeNotificationIds(eventTypes: [])",
        r#"activeNotificationIds(eventTypes: ["document_mention", "made_up"])"#,
        r#"activeNotificationIds(eventTypes: ["document_mention"], limit: 0)"#,
        r#"activeNotificationIds(eventTypes: ["document_mention"], limit: -1)"#,
        r#"activeNotificationIds(eventTypes: ["document_mention"], limit: 501)"#,
    ] {
        let response = harness
            .schema
            .execute(
                harness
                    .request(&format!("{{ user {{ {field} }} }}"), authenticated_parts())
                    .data(context(&repository)),
            )
            .await;

        assert_eq!(response.errors.len(), 1, "{field}");
        assert_eq!(
            response.errors[0].extensions.as_ref().unwrap().get("code"),
            Some(&async_graphql::Value::from("BAD_USER_INPUT")),
            "{field}"
        );
    }
    assert!(repository.reads.lock().unwrap().is_empty());
}

/// Fails every read the way storage does, with SQL in the failure.
struct FailingRepository {
    timed_out: bool,
}

impl ActiveNotificationIdRepository for FailingRepository {
    async fn active_notification_ids(
        &self,
        _user: MacroUserIdStr<'_>,
        _event_types: &[String],
        _limit: u32,
    ) -> Result<Vec<Uuid>, ActiveNotificationIdStorageError> {
        if self.timed_out {
            return Err(ActiveNotificationIdStorageError::TimedOut);
        }
        Err(ActiveNotificationIdStorageError::Failed(
            rootcause::report!("SELECT notification_id FROM user_notification failed"),
        ))
    }
}

#[tokio::test]
async fn storage_failures_are_internal_errors_marked_only_when_the_read_timed_out() {
    let harness = harness();

    for timed_out in [true, false] {
        let context = ActiveNotificationIdsGraphqlContext::new(ActiveNotificationIdService::new(
            FailingRepository { timed_out },
            model_notifications::NotifEvent::EVENT_TYPES,
        ));
        let response = harness
            .schema
            .execute(
                harness
                    .request(
                        r#"{ user { activeNotificationIds(eventTypes: ["document_mention"]) } }"#,
                        authenticated_parts(),
                    )
                    .data(context),
            )
            .await;

        assert_eq!(response.errors.len(), 1);
        let error = &response.errors[0];
        assert_eq!(error.message, "notifications are unavailable");
        let extensions = error.extensions.as_ref().unwrap();
        assert_eq!(
            extensions.get("code"),
            Some(&async_graphql::Value::from("INTERNAL_SERVER_ERROR"))
        );
        assert_eq!(
            extensions.get("timedOut"),
            timed_out.then(|| async_graphql::Value::from(true)).as_ref()
        );
    }
}

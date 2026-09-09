use std::sync::{Arc, Mutex};

use async_graphql::{EmptyMutation, EmptySubscription, Object, Schema, value};
use chrono::{TimeZone, Utc};
use model_entity::EntityType;

use super::*;

const USER_ID: &str = "macro|graphql-favorite-query@example.com";

#[derive(Clone, Default)]
struct RecordingReader {
    requested_users: Arc<Mutex<Vec<String>>>,
    fail: bool,
}

impl FavoriteQueryReader for RecordingReader {
    async fn list_favorites(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<Favorite>, FavoritesError> {
        self.requested_users
            .lock()
            .expect("requested users lock poisoned")
            .push(user_id.to_string());
        if self.fail {
            return Err(FavoritesError::BadRequest(
                "sensitive favorites detail".to_string(),
            ));
        }

        Ok(vec![Favorite {
            entity_type: EntityType::Document,
            entity_id: "document-1".to_string(),
            sort_order: 2.5,
            created_at: Utc.with_ymd_and_hms(2025, 1, 2, 3, 4, 5).unwrap(),
            file_type: Some("pdf".to_string()),
            document_sub_type: Some("task".to_string()),
            channel_type: None,
            channel_id: None,
        }])
    }
}

struct QueryRoot;

#[Object]
impl QueryRoot {
    async fn favorites(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<GraphqlFavorite>> {
        let user_id = MacroUserIdStr::parse_from_str(USER_ID).expect("valid user id");
        resolve_favorites::<RecordingReader>(ctx, &user_id).await
    }
}

fn schema(reader: RecordingReader) -> Schema<QueryRoot, EmptyMutation, EmptySubscription> {
    Schema::build(QueryRoot, EmptyMutation, EmptySubscription)
        .data(reader)
        .finish()
}

#[tokio::test]
async fn lists_ordered_favorites_for_the_bound_user() {
    let reader = RecordingReader::default();
    let response = schema(reader.clone())
        .execute(
            "{ favorites { id entityType entityId sortOrder createdAt fileType documentSubType channelType channelId } }",
        )
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data,
        value!({
            "favorites": [{
                "id": "document:document-1",
                "entityType": "DOCUMENT",
                "entityId": "document-1",
                "sortOrder": 2.5,
                "createdAt": "2025-01-02T03:04:05+00:00",
                "fileType": "pdf",
                "documentSubType": "task",
                "channelType": null,
                "channelId": null,
            }]
        })
    );
    assert_eq!(
        *reader
            .requested_users
            .lock()
            .expect("requested users lock poisoned"),
        vec![USER_ID.to_string()]
    );
}

#[tokio::test]
async fn returns_a_safe_error_when_favorites_cannot_be_loaded() {
    let response = schema(RecordingReader {
        fail: true,
        ..Default::default()
    })
    .execute("{ favorites { entityId } }")
    .await;

    assert_eq!(response.errors.len(), 1);
    assert_eq!(response.errors[0].message, "favorites are unavailable");
    assert!(!response.errors[0].message.contains("sensitive"));
}

use std::sync::{Arc, Mutex};

use async_graphql::{EmptyMutation, EmptySubscription, Object, Schema, value};
use chrono::{TimeZone, Utc};
use model_entity::EntityType;

use super::*;

const USER_ID: &str = "macro|graphql-favorite-query@example.com";

fn all_favorites() -> Vec<Favorite> {
    [
        (EntityType::Document, "document-1", 2.5),
        (EntityType::Document, "document-2", 3.5),
        (EntityType::Channel, "channel-1", 4.5),
    ]
    .into_iter()
    .map(|(entity_type, entity_id, sort_order)| Favorite {
        entity_type,
        entity_id: entity_id.to_string(),
        sort_order,
        created_at: Utc.with_ymd_and_hms(2025, 1, 2, 3, 4, 5).unwrap(),
        file_type: Some("pdf".to_string()),
        document_sub_type: Some("task".to_string()),
        channel_type: None,
        channel_id: None,
    })
    .collect()
}

#[derive(Clone, Default)]
struct RecordingReader {
    requested_users: Arc<Mutex<Vec<String>>>,
    requested_filters: Arc<Mutex<Vec<FavoriteFilter>>>,
    fail: bool,
}

impl RecordingReader {
    fn requested_filters(&self) -> Vec<FavoriteFilter> {
        self.requested_filters
            .lock()
            .expect("requested filters lock poisoned")
            .clone()
    }
}

impl FavoriteQueryReader for RecordingReader {
    async fn list_favorites(
        &self,
        user_id: &MacroUserIdStr<'static>,
        filter: &FavoriteFilter,
    ) -> Result<Vec<Favorite>, FavoritesError> {
        self.requested_users
            .lock()
            .expect("requested users lock poisoned")
            .push(user_id.to_string());
        self.requested_filters
            .lock()
            .expect("requested filters lock poisoned")
            .push(filter.clone());
        if self.fail {
            return Err(FavoritesError::BadRequest(
                "sensitive favorites detail".to_string(),
            ));
        }

        Ok(all_favorites()
            .into_iter()
            .filter(|favorite| {
                (filter.entity_types.is_empty()
                    || filter.entity_types.contains(&favorite.entity_type))
                    && (filter.entity_ids.is_empty()
                        || filter.entity_ids.contains(&favorite.entity_id))
            })
            .collect())
    }
}

struct QueryRoot;

#[Object]
impl QueryRoot {
    async fn favorites(
        &self,
        ctx: &Context<'_>,
        filter: Option<FavoritesFilterInput>,
    ) -> async_graphql::Result<Vec<GraphqlFavorite>> {
        let user_id = MacroUserIdStr::parse_from_str(USER_ID).expect("valid user id");
        resolve_favorites::<RecordingReader>(ctx, &user_id, filter.unwrap_or_default().into_model())
            .await
    }
}

fn schema(reader: RecordingReader) -> Schema<QueryRoot, EmptyMutation, EmptySubscription> {
    Schema::build(QueryRoot, EmptyMutation, EmptySubscription)
        .data(reader)
        .finish()
}

async fn queried_entity_ids(reader: &RecordingReader, query: &str) -> Vec<String> {
    let response = schema(reader.clone()).execute(query).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let async_graphql::Value::Object(data) = response.data else {
        panic!("expected an object response");
    };
    let async_graphql::Value::List(favorites) = &data["favorites"] else {
        panic!("expected a favorites list");
    };
    favorites
        .iter()
        .map(|favorite| {
            let async_graphql::Value::Object(favorite) = favorite else {
                panic!("expected a favorite object");
            };
            favorite["entityId"]
                .to_string()
                .trim_matches('"')
                .to_string()
        })
        .collect()
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
            }, {
                "id": "document:document-2",
                "entityType": "DOCUMENT",
                "entityId": "document-2",
                "sortOrder": 3.5,
                "createdAt": "2025-01-02T03:04:05+00:00",
                "fileType": "pdf",
                "documentSubType": "task",
                "channelType": null,
                "channelId": null,
            }, {
                "id": "channel:channel-1",
                "entityType": "CHANNEL",
                "entityId": "channel-1",
                "sortOrder": 4.5,
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
    assert_eq!(reader.requested_filters(), vec![FavoriteFilter::default()]);
}

#[tokio::test]
async fn a_type_only_filter_reaches_the_reader_and_narrows_the_result() {
    let reader = RecordingReader::default();
    let entity_ids = queried_entity_ids(
        &reader,
        "{ favorites(filter: { entityTypes: [CHANNEL] }) { entityId } }",
    )
    .await;

    assert_eq!(entity_ids, vec!["channel-1".to_string()]);
    assert_eq!(
        reader.requested_filters(),
        vec![FavoriteFilter {
            entity_types: vec![EntityType::Channel],
            entity_ids: Vec::new(),
        }]
    );
}

#[tokio::test]
async fn an_id_only_filter_reaches_the_reader_and_narrows_the_result() {
    let reader = RecordingReader::default();
    let entity_ids = queried_entity_ids(
        &reader,
        r#"{ favorites(filter: { entityIds: ["document-2", "channel-1"] }) { entityId } }"#,
    )
    .await;

    assert_eq!(
        entity_ids,
        vec!["document-2".to_string(), "channel-1".to_string()]
    );
    assert_eq!(
        reader.requested_filters(),
        vec![FavoriteFilter {
            entity_types: Vec::new(),
            entity_ids: vec!["document-2".to_string(), "channel-1".to_string()],
        }]
    );
}

#[tokio::test]
async fn the_two_filter_dimensions_are_combined() {
    let reader = RecordingReader::default();
    let entity_ids = queried_entity_ids(
        &reader,
        r#"{ favorites(filter: {
            entityTypes: [DOCUMENT],
            entityIds: ["document-2", "channel-1"]
        }) { entityId } }"#,
    )
    .await;

    assert_eq!(entity_ids, vec!["document-2".to_string()]);
    assert_eq!(
        reader.requested_filters(),
        vec![FavoriteFilter {
            entity_types: vec![EntityType::Document],
            entity_ids: vec!["document-2".to_string(), "channel-1".to_string()],
        }]
    );
}

#[tokio::test]
async fn an_empty_filter_input_constrains_nothing() {
    let reader = RecordingReader::default();
    let entity_ids = queried_entity_ids(&reader, "{ favorites(filter: {}) { entityId } }").await;

    assert_eq!(
        entity_ids,
        vec![
            "document-1".to_string(),
            "document-2".to_string(),
            "channel-1".to_string()
        ]
    );
    assert_eq!(reader.requested_filters(), vec![FavoriteFilter::default()]);
}

#[tokio::test]
async fn returns_a_safe_error_when_favorites_cannot_be_loaded() {
    let response = schema(RecordingReader {
        fail: true,
        ..Default::default()
    })
    .execute("{ favorites(filter: { entityTypes: [DOCUMENT] }) { entityId } }")
    .await;

    assert_eq!(response.errors.len(), 1);
    assert_eq!(response.errors[0].message, "favorites are unavailable");
    assert!(!response.errors[0].message.contains("sensitive"));
}

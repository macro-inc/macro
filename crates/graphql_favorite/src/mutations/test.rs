use std::sync::{Arc, Mutex};

use async_graphql::{Context, EmptySubscription, Object, Schema, SimpleObject, value};
use entity_mutation::EntityMutationActor;
use favorites::domain::models::FavoritesMutationActor;
use graphql_soup::SoupEntityEdges;
use model_entity::EntityType;
use uuid::Uuid;

use super::*;

/// Minimal query root for the isolated mutation schema.
struct QueryRoot;

#[Object]
impl QueryRoot {
    async fn health(&self) -> bool {
        true
    }
}

/// Minimal composed edge object needed by the shared mutation result.
#[derive(Clone, SimpleObject)]
struct TestSoupEdges {
    available: bool,
}

/// Minimal email edge object needed by the Soup edge trait.
#[derive(Clone, SimpleObject)]
struct TestEmailEdges {
    available: bool,
}

impl SoupEntityEdges for TestSoupEdges {
    type Property = String;
    type Notification = String;
    type ActivityEvent = String;
    type EmailThreadEdges = TestEmailEdges;

    fn from_entity(_entity: Entity<'static>) -> Self {
        Self { available: true }
    }

    fn email_thread_edges(_email_thread_id: Uuid) -> Self::EmailThreadEdges {
        TestEmailEdges { available: true }
    }

    async fn resolve_properties(
        &self,
        _ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<Self::Property>> {
        Ok(Vec::new())
    }

    async fn resolve_notifications(
        &self,
        _ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<Self::Notification>> {
        Ok(Vec::new())
    }

    async fn resolve_is_favorited(&self, _ctx: &Context<'_>) -> async_graphql::Result<bool> {
        Ok(true)
    }

    async fn resolve_viewer_permission(
        &self,
        _ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<graphql_permission::GraphqlEntityPermission>> {
        Ok(None)
    }

    async fn resolve_activity(
        &self,
        _ctx: &Context<'_>,
        _limit: Option<i32>,
    ) -> async_graphql::Result<Vec<Self::ActivityEvent>> {
        Ok(Vec::new())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SetCall {
    actor_user_id: String,
    organization_id: Option<i64>,
    entity_type: EntityType,
    entity_id: String,
    favorite: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ReorderCall {
    user_id: String,
    entities: Vec<(EntityType, String)>,
}

#[derive(Default)]
struct CapturingService {
    set_call: Mutex<Option<SetCall>>,
    reorder_call: Mutex<Option<ReorderCall>>,
}

impl FavoritesMutationService for CapturingService {
    async fn set_favorite(
        &self,
        actor: FavoritesMutationActor,
        entity: Entity<'static>,
        favorite: bool,
    ) -> Result<Entity<'static>, FavoritesError> {
        *self.set_call.lock().expect("set call lock poisoned") = Some(SetCall {
            actor_user_id: actor.user_id.to_string(),
            organization_id: actor.organization_id,
            entity_type: entity.entity_type,
            entity_id: entity.entity_id.to_string(),
            favorite,
        });
        Ok(entity)
    }

    async fn reorder_favorites(
        &self,
        user_id: MacroUserIdStr<'static>,
        ordered: Vec<Entity<'static>>,
    ) -> Result<Vec<Favorite>, FavoritesError> {
        *self
            .reorder_call
            .lock()
            .expect("reorder call lock poisoned") = Some(ReorderCall {
            user_id: user_id.to_string(),
            entities: ordered
                .iter()
                .map(|entity| (entity.entity_type, entity.entity_id.to_string()))
                .collect(),
        });
        Ok(ordered
            .into_iter()
            .enumerate()
            .map(|(index, entity)| Favorite {
                entity_type: entity.entity_type,
                entity_id: entity.entity_id.into_owned(),
                sort_order: index as f64,
                created_at: chrono::Utc::now(),
                file_type: None,
                document_sub_type: None,
                channel_type: None,
                channel_id: None,
            })
            .collect())
    }
}

fn user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|graphql-favorite@example.com").expect("valid user id")
}

fn schema(
    service: Arc<CapturingService>,
) -> Schema<QueryRoot, FavoriteMutationRoot<CapturingService, TestSoupEdges>, EmptySubscription> {
    let user_id = user_id();
    Schema::build(
        QueryRoot,
        FavoriteMutationRoot::<CapturingService, TestSoupEdges>::new(),
        EmptySubscription,
    )
    .data(service)
    .data(user_id.clone())
    .data(FavoritesMutationActor {
        user_id: user_id.clone(),
        organization_id: Some(42),
    })
    .data(EntityMutationActor {
        user_id,
        organization_id: Some(42),
    })
    .finish()
}

#[tokio::test]
async fn set_entity_favorite_preserves_the_toggle_and_delegates_to_favorites() {
    let service = Arc::new(CapturingService::default());
    let response = schema(service.clone())
        .execute(
            r#"
            mutation {
              setEntityFavorite(
                entity: { type: DOCUMENT, id: "document-1" }
                favorite: true
              ) {
                __typename
                ... on GraphqlMutationSuccess {
                  effects { __typename }
                }
              }
            }
            "#,
        )
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data,
        value!({
            "setEntityFavorite": {
                "__typename": "GraphqlMutationSuccess",
                "effects": [{ "__typename": "SoupUpdated" }],
            }
        })
    );
    assert_eq!(
        service
            .set_call
            .lock()
            .expect("set call lock poisoned")
            .clone(),
        Some(SetCall {
            actor_user_id: "macro|graphql-favorite@example.com".to_string(),
            organization_id: Some(42),
            entity_type: EntityType::Document,
            entity_id: "document-1".to_string(),
            favorite: true,
        })
    );
}

#[tokio::test]
async fn reorder_favorites_delegates_and_returns_authoritative_order() {
    let service = Arc::new(CapturingService::default());
    let response = schema(service.clone())
        .execute(
            r#"
            mutation {
              reorderFavorites(input: {
                favorites: [
                  { type: PROJECT, id: "project-1" }
                  { type: DOCUMENT, id: "document-1" }
                ]
              }) {
                entityType
                entityId
                sortOrder
              }
            }
            "#,
        )
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data,
        value!({
            "reorderFavorites": [
                {
                    "entityType": "PROJECT",
                    "entityId": "project-1",
                    "sortOrder": 0.0,
                },
                {
                    "entityType": "DOCUMENT",
                    "entityId": "document-1",
                    "sortOrder": 1.0,
                },
            ]
        })
    );
    assert_eq!(
        service
            .reorder_call
            .lock()
            .expect("reorder call lock poisoned")
            .clone(),
        Some(ReorderCall {
            user_id: "macro|graphql-favorite@example.com".to_string(),
            entities: vec![
                (EntityType::Project, "project-1".to_string()),
                (EntityType::Document, "document-1".to_string()),
            ],
        })
    );
}

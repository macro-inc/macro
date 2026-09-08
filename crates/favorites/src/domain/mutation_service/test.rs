use std::{collections::HashSet, sync::Mutex};

use chrono::Utc;
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};

use super::*;
use crate::domain::ports::FavoritesAuthorizer;

const USER_ID: &str = "macro|favorites-mutation@example.com";

#[derive(Clone, Debug, PartialEq, Eq)]
enum ServiceCall {
    Add(EntityType, String),
    Remove(EntityType, String),
    Reorder(Vec<(EntityType, String)>),
    List,
}

#[derive(Default)]
struct FakeFavoritesService {
    calls: Mutex<Vec<ServiceCall>>,
}

impl FakeFavoritesService {
    fn calls(&self) -> Vec<ServiceCall> {
        self.calls.lock().expect("calls lock poisoned").clone()
    }
}

impl FavoritesService for FakeFavoritesService {
    async fn add_favorite(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Favorite, FavoritesError> {
        let entity = receipt.entity();
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(ServiceCall::Add(
                entity.entity_type,
                entity.entity_id.clone(),
            ));
        Ok(favorite(entity.entity_type, &entity.entity_id, 0.0))
    }

    async fn add_favorite_with_established_access(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> Result<Favorite, FavoritesError> {
        Ok(favorite(entity.entity_type, &entity.entity_id, 0.0))
    }

    async fn list_favorites(
        &self,
        _user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<Favorite>, FavoritesError> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(ServiceCall::List);
        Ok(vec![favorite(EntityType::Document, "document-1", 0.0)])
    }

    async fn remove_favorite_by_entity(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> Result<(), FavoritesError> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(ServiceCall::Remove(
                entity.entity_type,
                entity.entity_id.to_string(),
            ));
        Ok(())
    }

    async fn reorder_favorites(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        ordered: &[Entity<'_>],
    ) -> Result<(), FavoritesError> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(ServiceCall::Reorder(
                ordered
                    .iter()
                    .map(|entity| (entity.entity_type, entity.entity_id.to_string()))
                    .collect(),
            ));
        Ok(())
    }

    async fn favorited_entities(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _entities: &[Entity<'_>],
    ) -> Result<HashSet<Entity<'static>>, FavoritesError> {
        Ok(HashSet::new())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct AuthorizerCall {
    user_id: String,
    organization_id: Option<i64>,
    entity_type: EntityType,
    entity_id: String,
}

#[derive(Default)]
struct FakeAuthorizer {
    calls: Mutex<Vec<AuthorizerCall>>,
}

impl FakeAuthorizer {
    fn calls(&self) -> Vec<AuthorizerCall> {
        self.calls.lock().expect("calls lock poisoned").clone()
    }
}

impl FavoritesAuthorizer for FakeAuthorizer {
    async fn authorize_favorite(
        &self,
        actor: &FavoritesMutationActor,
        entity: &Entity<'static>,
    ) -> Result<EntityAccessReceipt<ViewAccessLevel>, FavoritesError> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(AuthorizerCall {
                user_id: actor.user_id.to_string(),
                organization_id: actor.organization_id,
                entity_type: entity.entity_type,
                entity_id: entity.entity_id.to_string(),
            });
        Ok(
            EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_authenticated_user(
                actor.user_id.clone(),
                &entity.entity_id,
                entity.entity_type,
            ),
        )
    }
}

fn actor() -> FavoritesMutationActor {
    FavoritesMutationActor {
        user_id: MacroUserIdStr::parse_from_str(USER_ID).expect("valid user id"),
        organization_id: Some(42),
    }
}

fn favorite(entity_type: EntityType, entity_id: &str, sort_order: f64) -> Favorite {
    Favorite {
        entity_type,
        entity_id: entity_id.to_string(),
        sort_order,
        created_at: Utc::now(),
        file_type: None,
        document_sub_type: None,
        channel_type: None,
        channel_id: None,
    }
}

#[tokio::test]
async fn favorite_authorizes_then_delegates_to_core_service() {
    let favorites = Arc::new(FakeFavoritesService::default());
    let authorizer = Arc::new(FakeAuthorizer::default());
    let service = FavoritesMutationServiceImpl::new(favorites.clone(), authorizer.clone());
    let entity = EntityType::Document.with_entity_string("document-1".to_string());

    let updated = service
        .set_favorite(actor(), entity.clone(), true)
        .await
        .expect("favorite should succeed");

    assert_eq!(updated, entity);
    assert_eq!(
        authorizer.calls(),
        vec![AuthorizerCall {
            user_id: USER_ID.to_string(),
            organization_id: Some(42),
            entity_type: EntityType::Document,
            entity_id: "document-1".to_string(),
        }]
    );
    assert_eq!(
        favorites.calls(),
        vec![ServiceCall::Add(
            EntityType::Document,
            "document-1".to_string()
        )]
    );
}

#[tokio::test]
async fn unfavorite_delegates_without_requiring_current_entity_access() {
    let favorites = Arc::new(FakeFavoritesService::default());
    let authorizer = Arc::new(FakeAuthorizer::default());
    let service = FavoritesMutationServiceImpl::new(favorites.clone(), authorizer.clone());
    let entity = EntityType::Document.with_entity_string("document-1".to_string());

    let updated = service
        .set_favorite(actor(), entity.clone(), false)
        .await
        .expect("unfavorite should succeed");

    assert_eq!(updated, entity);
    assert!(authorizer.calls().is_empty());
    assert_eq!(
        favorites.calls(),
        vec![ServiceCall::Remove(
            EntityType::Document,
            "document-1".to_string()
        )]
    );
}

#[tokio::test]
async fn unsupported_toggle_is_rejected_before_authorization_or_persistence() {
    let favorites = Arc::new(FakeFavoritesService::default());
    let authorizer = Arc::new(FakeAuthorizer::default());
    let service = FavoritesMutationServiceImpl::new(favorites.clone(), authorizer.clone());

    let error = service
        .set_favorite(
            actor(),
            EntityType::User.with_entity_string("user-1".to_string()),
            true,
        )
        .await
        .expect_err("users are not favoritable");

    assert!(matches!(
        error,
        FavoritesError::UnsupportedEntityType(EntityType::User)
    ));
    assert!(authorizer.calls().is_empty());
    assert!(favorites.calls().is_empty());
}

#[tokio::test]
async fn reorder_delegates_and_returns_the_authoritative_collection() {
    let favorites = Arc::new(FakeFavoritesService::default());
    let service =
        FavoritesMutationServiceImpl::new(favorites.clone(), Arc::new(FakeAuthorizer::default()));
    let ordered = vec![EntityType::Document.with_entity_string("document-1".to_string())];

    let result = service
        .reorder_favorites(actor().user_id, ordered)
        .await
        .expect("reorder should succeed");

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].entity_id, "document-1");
    assert_eq!(
        favorites.calls(),
        vec![
            ServiceCall::Reorder(vec![(EntityType::Document, "document-1".to_string())]),
            ServiceCall::List,
        ]
    );
}

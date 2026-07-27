use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};

use super::{FavoritesServiceImpl, MAX_FAVORITES_PER_COLLECTION};
use crate::domain::models::{Favorite, FavoritesError};
use crate::domain::ports::{FavoritesRepo, FavoritesService};

const USER_ID: &str = "macro|favorites-user@macro.com";

#[derive(Clone, Debug, PartialEq, Eq)]
enum RepoCall {
    Count {
        user_id: String,
    },
    Add {
        user_id: String,
        entity_type: EntityType,
        entity_id: String,
    },
}

#[derive(Clone)]
struct FakeFavoritesRepo {
    count: i64,
    calls: Arc<Mutex<Vec<RepoCall>>>,
}

impl FakeFavoritesRepo {
    fn new(count: i64) -> Self {
        Self {
            count,
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn recorded_calls(&self) -> Vec<RepoCall> {
        self.calls.lock().expect("calls lock poisoned").clone()
    }

    fn record(&self, call: RepoCall) {
        self.calls.lock().expect("calls lock poisoned").push(call);
    }
}

#[derive(Debug, thiserror::Error)]
#[error("fake favorites repository error")]
struct FakeRepoError;

impl FavoritesRepo for FakeFavoritesRepo {
    type Err = FakeRepoError;

    async fn add_favorite(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> Result<Favorite, Self::Err> {
        self.record(RepoCall::Add {
            user_id: user_id.as_ref().to_string(),
            entity_type: entity.entity_type,
            entity_id: entity.entity_id.to_string(),
        });

        Ok(Favorite {
            entity_type: entity.entity_type,
            entity_id: entity.entity_id.to_string(),
            sort_order: 0.0,
            created_at: Utc::now(),
            file_type: None,
            document_sub_type: None,
            channel_type: None,
            channel_id: None,
        })
    }

    async fn count_favorites(&self, user_id: &MacroUserIdStr<'_>) -> Result<i64, Self::Err> {
        self.record(RepoCall::Count {
            user_id: user_id.as_ref().to_string(),
        });
        Ok(self.count)
    }

    async fn list_favorites(
        &self,
        _user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<Favorite>, Self::Err> {
        Ok(Vec::new())
    }

    async fn remove_favorite_by_entity(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _entity: &Entity<'_>,
    ) -> Result<bool, Self::Err> {
        Ok(false)
    }

    async fn reorder_favorites(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _ordered: &[Entity<'_>],
    ) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn favorited_entities(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _entities: &[Entity<'_>],
    ) -> Result<HashSet<Entity<'static>>, Self::Err> {
        Ok(HashSet::new())
    }
}

fn user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(USER_ID).expect("valid user id")
}

fn authenticated_receipt(
    entity_id: &str,
    entity_type: EntityType,
) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(user_id(), entity_id, entity_type)
}

#[tokio::test]
async fn add_favorite_forwards_authenticated_user_and_receipt_entity() {
    let repo = FakeFavoritesRepo::new(0);
    let service = FavoritesServiceImpl::new(repo.clone());
    let receipt = authenticated_receipt("channel-123", EntityType::Channel);

    let favorite = service
        .add_favorite(&receipt)
        .await
        .expect("favorite should be added");

    assert_eq!(favorite.entity_type, EntityType::Channel);
    assert_eq!(favorite.entity_id, "channel-123");
    assert_eq!(
        repo.recorded_calls(),
        vec![
            RepoCall::Count {
                user_id: USER_ID.to_string(),
            },
            RepoCall::Add {
                user_id: USER_ID.to_string(),
                entity_type: EntityType::Channel,
                entity_id: "channel-123".to_string(),
            },
        ]
    );
}

#[tokio::test]
async fn add_favorite_with_established_access_forwards_user_and_entity() {
    let repo = FakeFavoritesRepo::new(0);
    let service = FavoritesServiceImpl::new(repo.clone());
    let user_id = user_id();
    let entity = EntityType::Channel.with_entity_str("channel-123");

    let favorite = service
        .add_favorite_with_established_access(&user_id, &entity)
        .await
        .expect("favorite should be added");

    assert_eq!(favorite.entity_type, EntityType::Channel);
    assert_eq!(favorite.entity_id, "channel-123");
    assert_eq!(
        repo.recorded_calls(),
        vec![
            RepoCall::Count {
                user_id: USER_ID.to_string(),
            },
            RepoCall::Add {
                user_id: USER_ID.to_string(),
                entity_type: EntityType::Channel,
                entity_id: "channel-123".to_string(),
            },
        ]
    );
}

#[tokio::test]
async fn add_favorite_rejects_internal_receipt_before_repository_calls() {
    let repo = FakeFavoritesRepo::new(0);
    let service = FavoritesServiceImpl::new(repo.clone());
    let receipt = EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_internal_user(
        "doc-123",
        EntityType::Document,
    );

    let error = service
        .add_favorite(&receipt)
        .await
        .expect_err("internal receipt should be rejected");

    assert!(matches!(error, FavoritesError::Unauthorized));
    assert_eq!(error.to_string(), "you do not have access to this entity");
    assert!(repo.recorded_calls().is_empty());
}

#[tokio::test]
async fn add_favorite_rejects_empty_entity_id_before_repository_calls() {
    let repo = FakeFavoritesRepo::new(0);
    let service = FavoritesServiceImpl::new(repo.clone());
    let receipt = authenticated_receipt("  ", EntityType::Document);

    let error = service
        .add_favorite(&receipt)
        .await
        .expect_err("empty entity id should be rejected");

    assert!(
        matches!(error, FavoritesError::BadRequest(message) if message == "entity_id must not be empty")
    );
    assert!(repo.recorded_calls().is_empty());
}

#[tokio::test]
async fn add_favorite_rejects_collection_at_cap_before_add() {
    let repo = FakeFavoritesRepo::new(MAX_FAVORITES_PER_COLLECTION as i64);
    let service = FavoritesServiceImpl::new(repo.clone());
    let receipt = authenticated_receipt("doc-123", EntityType::Document);

    let error = service
        .add_favorite(&receipt)
        .await
        .expect_err("full collection should reject add");

    assert!(matches!(
        error,
        FavoritesError::BadRequest(message)
            if message == format!(
                "cannot have more than {MAX_FAVORITES_PER_COLLECTION} favorites"
            )
    ));
    assert_eq!(
        repo.recorded_calls(),
        vec![RepoCall::Count {
            user_id: USER_ID.to_string(),
        }]
    );
}

#[tokio::test]
async fn repeated_adds_are_delegated_to_repository_for_idempotency() {
    let repo = FakeFavoritesRepo::new(0);
    let service = FavoritesServiceImpl::new(repo.clone());
    let receipt = authenticated_receipt("doc-123", EntityType::Document);

    service
        .add_favorite(&receipt)
        .await
        .expect("first add should succeed");
    service
        .add_favorite(&receipt)
        .await
        .expect("repeated add should succeed");

    let count_call = RepoCall::Count {
        user_id: USER_ID.to_string(),
    };
    let add_call = RepoCall::Add {
        user_id: USER_ID.to_string(),
        entity_type: EntityType::Document,
        entity_id: "doc-123".to_string(),
    };
    assert_eq!(
        repo.recorded_calls(),
        vec![count_call.clone(), add_call.clone(), count_call, add_call]
    );
}

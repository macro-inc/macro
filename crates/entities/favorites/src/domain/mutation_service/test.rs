use std::{collections::HashSet, sync::Mutex};

use chrono::Utc;
use cowlike::CowLike;
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, Entity as AccessEntity,
        EntityAccessReceipt, EntityPermission, ParticipantRole, RequiredPermission, TeamRole,
        UserTeamInfo,
    },
    ports::EntityAccessService,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use uuid::Uuid;

use super::*;
use crate::domain::ports::{FavoriteView, FavoritesAuthorizer};

const USER_ID: &str = "macro|favorites-mutation@example.com";

#[derive(Clone, Debug, PartialEq, Eq)]
enum ServiceCall {
    Add(EntityType, String),
    Remove(EntityType, String),
    Reorder(Vec<(EntityType, String)>),
    List(FavoriteFilter),
}

#[derive(Default)]
struct FakeFavoritesService {
    calls: Mutex<Vec<ServiceCall>>,
    remove_missing: bool,
}

impl FakeFavoritesService {
    fn calls(&self) -> Vec<ServiceCall> {
        self.calls.lock().expect("calls lock poisoned").clone()
    }
}

impl FavoritesService for FakeFavoritesService {
    async fn add_favorite(
        &self,
        receipt: &EntityAccessReceipt<FavoriteView>,
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
        filter: &FavoriteFilter,
    ) -> Result<Vec<Favorite>, FavoritesError> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(ServiceCall::List(filter.clone()));
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
        if self.remove_missing {
            return Err(FavoritesError::NotFound);
        }
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
    deny: bool,
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
    ) -> Result<EntityAccessReceipt<FavoriteView>, FavoritesError> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(AuthorizerCall {
                user_id: actor.user_id.to_string(),
                organization_id: actor.organization_id,
                entity_type: entity.entity_type,
                entity_id: entity.entity_id.to_string(),
            });
        if self.deny {
            return Err(FavoritesError::Unauthorized);
        }
        Ok(
            EntityAccessReceipt::<FavoriteView>::dangerously_assert_authenticated_user(
                actor.user_id.clone(),
                &entity.entity_id,
                entity.entity_type,
            ),
        )
    }
}

/// Entity access that resolves every entity to one permission and mints
/// receipts through the same requirement check as the real service.
#[derive(Clone)]
struct ResolvedAccess {
    permission: EntityPermission,
}

impl EntityAccessService for ResolvedAccess {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        EntityAccessReceipt::try_new_authenticated_user(
            MacroUserIdStr(user_id.clone().into_owned()),
            AccessEntity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            self.permission,
        )
    }
    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _: BotId,
        _: BotAccessScope,
        _: &str,
        _: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unreachable!()
    }
    async fn get_access_level(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        unreachable!()
    }
    async fn check_access(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
        _: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unreachable!()
    }
    async fn check_public_access(
        &self,
        _: &str,
        _: EntityType,
        _: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unreachable!()
    }
    async fn get_entity_permission(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
        _: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        unreachable!()
    }
    async fn get_crm_entity_permission_with_team(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        unreachable!()
    }
    async fn get_users_by_entity(
        &self,
        _: &str,
        _: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        unreachable!()
    }
    async fn get_call_channel(&self, _: &Uuid) -> Result<Option<CallChannelInfo>, AccessError> {
        unreachable!()
    }
    async fn get_call_channel_by_channel_id(
        &self,
        _: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        unreachable!()
    }
    async fn get_user_team(
        &self,
        _: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        unreachable!()
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

    let result = service
        .set_favorite(actor(), entity.clone(), true)
        .await
        .expect("favorite should succeed");

    assert_eq!(result.entity, entity);
    assert_eq!(
        result
            .favorite
            .as_ref()
            .map(|favorite| favorite.entity_id.as_str()),
        Some("document-1")
    );
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

    let result = service
        .set_favorite(actor(), entity.clone(), false)
        .await
        .expect("unfavorite should succeed");

    assert_eq!(result.entity, entity);
    assert!(result.favorite.is_none());
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
async fn every_supported_interactive_entity_can_be_added_and_removed() {
    for entity_type in [
        EntityType::Document,
        EntityType::Chat,
        EntityType::Project,
        EntityType::EmailThread,
        EntityType::Channel,
        EntityType::Call,
        EntityType::ForeignEntity,
        EntityType::CrmCompany,
        EntityType::CrmContact,
        EntityType::AgentSession,
        EntityType::Database,
        EntityType::Form,
    ] {
        let favorites = Arc::new(FakeFavoritesService::default());
        let authorizer = Arc::new(FakeAuthorizer::default());
        let service = FavoritesMutationServiceImpl::new(favorites.clone(), authorizer.clone());
        let entity = entity_type.with_entity_string("entity-1".to_string());

        let added = service
            .set_favorite(actor(), entity.clone(), true)
            .await
            .unwrap();
        assert_eq!(added.favorite.unwrap().entity_type, entity_type);
        let removed = service.set_favorite(actor(), entity, false).await.unwrap();
        assert!(removed.favorite.is_none());
        assert_eq!(authorizer.calls().len(), 1);
        assert_eq!(
            favorites.calls(),
            vec![
                ServiceCall::Add(entity_type, "entity-1".to_string()),
                ServiceCall::Remove(entity_type, "entity-1".to_string()),
            ]
        );
    }
}

#[tokio::test]
async fn entity_access_authorizes_each_entity_kind_with_its_own_view_permission() {
    for (entity_type, permission) in [
        (
            EntityType::Document,
            EntityPermission::AccessLevel {
                access_level: AccessLevel::View,
            },
        ),
        (EntityType::Channel, EntityPermission::ChannelViewOnly),
        (
            EntityType::Channel,
            EntityPermission::ChannelRole {
                role: ParticipantRole::Member,
            },
        ),
    ] {
        let favorites = Arc::new(FakeFavoritesService::default());
        let service = FavoritesMutationServiceImpl::new(
            favorites.clone(),
            Arc::new(ResolvedAccess { permission }),
        );

        let result = service
            .set_favorite(
                actor(),
                entity_type.with_entity_string("entity-1".to_string()),
                true,
            )
            .await;

        assert!(
            result.is_ok(),
            "{entity_type:?} with {permission:?} should be favoritable, got {result:?}"
        );
        assert_eq!(
            favorites.calls(),
            vec![ServiceCall::Add(entity_type, "entity-1".to_string())]
        );
    }
}

#[tokio::test]
async fn denied_contact_add_never_reaches_persistence() {
    let favorites = Arc::new(FakeFavoritesService::default());
    let authorizer = Arc::new(FakeAuthorizer {
        deny: true,
        ..Default::default()
    });
    let service = FavoritesMutationServiceImpl::new(favorites.clone(), authorizer);
    let result = service
        .set_favorite(
            actor(),
            EntityType::CrmContact.with_entity_string("contact-1".into()),
            true,
        )
        .await;

    assert!(matches!(result, Err(FavoritesError::Unauthorized)));
    assert!(favorites.calls().is_empty());
}

#[tokio::test]
async fn replaying_an_already_removed_favorite_succeeds() {
    let favorites = Arc::new(FakeFavoritesService {
        remove_missing: true,
        ..Default::default()
    });
    let service = FavoritesMutationServiceImpl::new(favorites, Arc::new(FakeAuthorizer::default()));
    let result = service
        .set_favorite(
            actor(),
            EntityType::Document.with_entity_string("document-1".into()),
            false,
        )
        .await
        .expect("an already absent favorite satisfies the requested state");

    assert!(result.favorite.is_none());
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
            ServiceCall::List(FavoriteFilter::default()),
        ]
    );
}

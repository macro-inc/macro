//! Ports (trait contracts) for the favorites domain.

use std::collections::HashSet;

use entity_access::domain::{
    models::{
        AccessError, AccessLevel, Entity as AccessEntity, EntityAccessReceipt, EntityPermission,
        ViewAccessLevel, ViewOnly,
    },
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;

use crate::domain::models::{
    Favorite, FavoriteFilter, FavoritesError, FavoritesMutationActor, SetFavoriteResult,
};

/// Outbound persistence port for favorites.
pub trait FavoritesRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: Send + std::fmt::Debug;

    /// Insert a favorite at the end of the user's collection.
    ///
    /// Adding an entity that is already favorited by the user is a no-op
    /// that returns the existing record.
    fn add_favorite(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> impl Future<Output = Result<Favorite, Self::Err>> + Send;

    /// Count the favorites currently in the user's collection.
    fn count_favorites(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<i64, Self::Err>> + Send;

    /// List the user's favorites matching `filter`, in manual order, hydrated
    /// with display metadata. Favorites pointing at deleted entities are
    /// omitted.
    fn list_favorites(
        &self,
        user_id: &MacroUserIdStr<'_>,
        filter: &FavoriteFilter,
    ) -> impl Future<Output = Result<Vec<Favorite>, Self::Err>> + Send;

    /// Remove the favorite for the given entity from the user's collection.
    ///
    /// Returns `true` when a row was removed.
    fn remove_favorite_by_entity(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Persist a manual ordering for the user's favorites. `ordered` is the
    /// full list of the user's favorited entities in the desired order;
    /// entities the user has not favorited are ignored.
    fn reorder_favorites(
        &self,
        user_id: &MacroUserIdStr<'_>,
        ordered: &[Entity<'_>],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Of the given entities, return the subset favorited by the user.
    fn favorited_entities(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entities: &[Entity<'_>],
    ) -> impl Future<Output = Result<HashSet<Entity<'static>>, Self::Err>> + Send;
}

/// Authorization port used by favorites mutation use cases.
pub trait FavoritesAuthorizer: Send + Sync + 'static {
    /// Verify that the actor can view the entity being added to favorites.
    fn authorize_favorite(
        &self,
        actor: &FavoritesMutationActor,
        entity: &Entity<'static>,
    ) -> impl Future<Output = Result<EntityAccessReceipt<ViewAccessLevel>, FavoritesError>> + Send;
}

impl<A> FavoritesAuthorizer for A
where
    A: EntityAccessService,
{
    async fn authorize_favorite(
        &self,
        actor: &FavoritesMutationActor,
        entity: &Entity<'static>,
    ) -> Result<EntityAccessReceipt<ViewAccessLevel>, FavoritesError> {
        // Resolve the native permission for the entity kind. Documents and
        // similar items use AccessLevel; channels use ChannelRole /
        // ChannelViewOnly, which intentionally do not satisfy ViewAccessLevel.
        let permission = self
            .get_entity_permission(
                Some(&actor.user_id),
                &entity.entity_id,
                entity.entity_type,
                actor.organization_id,
            )
            .await
            .map_err(map_access_error)?;

        // Favoriting only requires view access. Accept either permission model.
        let can_view =
            permission.satisfies::<ViewAccessLevel>() || permission.satisfies::<ViewOnly>();
        if !can_view {
            return Err(FavoritesError::Unauthorized);
        }

        // FavoritesService expects a ViewAccessLevel receipt. Project channel
        // permissions onto AccessLevel::View so the receipt marker validates.
        let receipt_permission = match permission {
            EntityPermission::ChannelRole { .. } | EntityPermission::ChannelViewOnly => {
                EntityPermission::AccessLevel {
                    access_level: AccessLevel::View,
                }
            }
            other => other,
        };

        EntityAccessReceipt::<ViewAccessLevel>::try_new_authenticated_user(
            actor.user_id.clone(),
            AccessEntity {
                entity_id: entity.entity_id.to_string(),
                entity_type: entity.entity_type,
            },
            receipt_permission,
        )
        .map_err(map_access_error)
    }
}

fn map_access_error(error: AccessError) -> FavoritesError {
    match error {
        AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
            FavoritesError::Unauthorized
        }
        AccessError::NotFound(_) => FavoritesError::NotFound,
        AccessError::BadRequest(message) => FavoritesError::BadRequest(message.to_string()),
        error @ (AccessError::Unavailable(_) | AccessError::Internal(_)) => {
            FavoritesError::Internal(anyhow::Error::new(error))
        }
    }
}

/// Inbound service port for favorite and ordering mutations.
pub trait FavoritesMutationService: Send + Sync + 'static {
    /// Set whether an entity belongs to the actor's favorites collection.
    fn set_favorite(
        &self,
        actor: FavoritesMutationActor,
        entity: Entity<'static>,
        favorite: bool,
    ) -> impl Future<Output = Result<SetFavoriteResult, FavoritesError>> + Send;

    /// Persist a complete manual order and return the authoritative collection.
    fn reorder_favorites(
        &self,
        user_id: MacroUserIdStr<'static>,
        ordered: Vec<Entity<'static>>,
    ) -> impl Future<Output = Result<Vec<Favorite>, FavoritesError>> + Send;
}

/// Inbound service port: the favorites API used by drivers (HTTP, soup enrichment).
pub trait FavoritesService: Send + Sync + 'static {
    /// Add an entity to the user's favorites (idempotent).
    fn add_favorite(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<Favorite, FavoritesError>> + Send;

    /// Add an entity after a trusted caller has already established that the
    /// user can view it.
    ///
    /// This supports internal workflows, such as favoriting an entity that the
    /// same workflow just created for the user, where no access receipt exists
    /// at the driving boundary.
    fn add_favorite_with_established_access(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> impl Future<Output = Result<Favorite, FavoritesError>> + Send;

    /// List the user's favorites in manual order, restricted by `filter`.
    fn list_favorites(
        &self,
        user_id: &MacroUserIdStr<'_>,
        filter: &FavoriteFilter,
    ) -> impl Future<Output = Result<Vec<Favorite>, FavoritesError>> + Send;

    /// Remove the favorite for the given entity from the user's collection.
    fn remove_favorite_by_entity(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> impl Future<Output = Result<(), FavoritesError>> + Send;

    /// Persist a manual ordering for the user's favorites.
    fn reorder_favorites(
        &self,
        user_id: &MacroUserIdStr<'_>,
        ordered: &[Entity<'_>],
    ) -> impl Future<Output = Result<(), FavoritesError>> + Send;

    /// Of the given entities, return the subset favorited by the user.
    fn favorited_entities(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entities: &[Entity<'_>],
    ) -> impl Future<Output = Result<HashSet<Entity<'static>>, FavoritesError>> + Send;
}

#[cfg(test)]
mod test {
    use super::*;
    use entity_access::domain::{
        models::{
            BotAccessScope, BotId, CallChannelInfo, ParticipantRole, RequiredPermission, TeamRole,
            UserTeamInfo,
        },
        ports::EntityAccessService,
    };
    use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
    use model_entity::EntityType;
    use std::sync::Mutex;
    use uuid::Uuid;

    #[derive(Clone)]
    struct ScriptedAccess {
        permission: std::sync::Arc<Mutex<Result<EntityPermission, AccessError>>>,
    }

    impl ScriptedAccess {
        fn ok(permission: EntityPermission) -> Self {
            Self {
                permission: std::sync::Arc::new(Mutex::new(Ok(permission))),
            }
        }

        fn err(error: AccessError) -> Self {
            Self {
                permission: std::sync::Arc::new(Mutex::new(Err(error))),
            }
        }
    }

    impl EntityAccessService for ScriptedAccess {
        async fn generate_entity_access_receipt<T: RequiredPermission>(
            &self,
            _user_id: &MacroUserId<Lowercase<'_>>,
            _user_org_id: Option<i64>,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> Result<EntityAccessReceipt<T>, AccessError> {
            Err(AccessError::internal("unused"))
        }

        async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
            &self,
            _bot_id: BotId,
            _scope: BotAccessScope,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> Result<EntityAccessReceipt<T>, AccessError> {
            Err(AccessError::internal("unused"))
        }

        async fn get_access_level(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> Result<Option<AccessLevel>, AccessError> {
            Err(AccessError::internal("unused"))
        }

        async fn check_access(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
            _required_level: AccessLevel,
        ) -> Result<AccessLevel, AccessError> {
            Err(AccessError::internal("unused"))
        }

        async fn check_public_access(
            &self,
            _entity_id: &str,
            _entity_type: EntityType,
            _required_level: AccessLevel,
        ) -> Result<AccessLevel, AccessError> {
            Err(AccessError::internal("unused"))
        }

        async fn get_entity_permission(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
            _user_org_id: Option<i64>,
        ) -> Result<EntityPermission, AccessError> {
            match &*self.permission.lock().expect("lock") {
                Ok(permission) => Ok(*permission),
                Err(AccessError::Unauthorized) => Err(AccessError::Unauthorized),
                Err(AccessError::NotFound(message)) => Err(AccessError::NotFound(*message)),
                Err(_) => Err(AccessError::internal("scripted error")),
            }
        }

        async fn get_crm_entity_permission_with_team(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
            Err(AccessError::internal("unused"))
        }

        async fn get_users_by_entity(
            &self,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
            Err(AccessError::internal("unused"))
        }

        async fn get_call_channel(
            &self,
            _call_id: &Uuid,
        ) -> Result<Option<CallChannelInfo>, AccessError> {
            Err(AccessError::internal("unused"))
        }

        async fn get_call_channel_by_channel_id(
            &self,
            _channel_id: &Uuid,
        ) -> Result<Option<CallChannelInfo>, AccessError> {
            Err(AccessError::internal("unused"))
        }

        async fn get_user_team(
            &self,
            _user_id: &MacroUserId<Lowercase<'_>>,
        ) -> Result<Option<UserTeamInfo>, AccessError> {
            Ok(None)
        }
    }

    fn actor() -> FavoritesMutationActor {
        FavoritesMutationActor {
            user_id: MacroUserIdStr::parse_from_str("macro|favorites@example.com")
                .expect("valid user id"),
            organization_id: Some(7),
        }
    }

    fn channel_entity() -> Entity<'static> {
        EntityType::Channel.with_entity_str("019f6610-7566-751d-893c-58cf686bbd4d")
    }

    #[tokio::test]
    async fn authorize_favorite_accepts_channel_participant_role() {
        let access = ScriptedAccess::ok(EntityPermission::ChannelRole {
            role: ParticipantRole::Member,
        });

        let receipt = access
            .authorize_favorite(&actor(), &channel_entity())
            .await
            .expect("channel member can favorite");

        assert!(matches!(
            receipt.entity_permission(),
            EntityPermission::AccessLevel {
                access_level: AccessLevel::View
            }
        ));
    }

    #[tokio::test]
    async fn authorize_favorite_accepts_channel_view_only() {
        let access = ScriptedAccess::ok(EntityPermission::ChannelViewOnly);

        access
            .authorize_favorite(&actor(), &channel_entity())
            .await
            .expect("channel view-only can favorite");
    }

    #[tokio::test]
    async fn authorize_favorite_accepts_document_view_access_level() {
        let access = ScriptedAccess::ok(EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        });
        let document = EntityType::Document.with_entity_str("doc-1");

        access
            .authorize_favorite(&actor(), &document)
            .await
            .expect("document viewer can favorite");
    }

    #[tokio::test]
    async fn authorize_favorite_rejects_unauthorized_channel() {
        let access = ScriptedAccess::err(AccessError::Unauthorized);

        let error = access
            .authorize_favorite(&actor(), &channel_entity())
            .await
            .expect_err("no channel access");

        assert!(matches!(error, FavoritesError::Unauthorized));
    }
}

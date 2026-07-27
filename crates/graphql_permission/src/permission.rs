use std::{collections::HashMap, sync::Arc};

use async_graphql::{Context, Enum, SimpleObject, Union, dataloader::DataLoader};
use entity_access::domain::{
    models::{AccessError, AccessLevel, EntityPermission, ParticipantRole, TeamRole},
    ports::EntityAccessService,
};
use futures::{StreamExt, stream};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, OwnedEntity};
use rootcause::markers::{Cloneable, Dynamic};

/// Item access level resolved for the current viewer.
#[derive(Enum, Clone, Copy, PartialEq, Eq)]
pub enum GraphqlEntityAccessLevel {
    /// Read-only access.
    View,
    /// Comment access.
    Comment,
    /// Edit access.
    Edit,
    /// Owner access.
    Owner,
}

impl From<AccessLevel> for GraphqlEntityAccessLevel {
    fn from(value: AccessLevel) -> Self {
        match value {
            AccessLevel::View => Self::View,
            AccessLevel::Comment => Self::Comment,
            AccessLevel::Edit => Self::Edit,
            AccessLevel::Owner => Self::Owner,
        }
    }
}

impl From<GraphqlEntityAccessLevel> for AccessLevel {
    fn from(value: GraphqlEntityAccessLevel) -> Self {
        match value {
            GraphqlEntityAccessLevel::View => Self::View,
            GraphqlEntityAccessLevel::Comment => Self::Comment,
            GraphqlEntityAccessLevel::Edit => Self::Edit,
            GraphqlEntityAccessLevel::Owner => Self::Owner,
        }
    }
}

/// Channel role resolved for the current viewer.
#[derive(Enum, Clone, Copy, PartialEq, Eq)]
pub enum GraphqlChannelParticipantRole {
    /// Channel owner.
    Owner,
    /// Channel administrator.
    Admin,
    /// Channel member.
    Member,
}

impl From<ParticipantRole> for GraphqlChannelParticipantRole {
    fn from(value: ParticipantRole) -> Self {
        match value {
            ParticipantRole::Owner => Self::Owner,
            ParticipantRole::Admin => Self::Admin,
            ParticipantRole::Member => Self::Member,
        }
    }
}

/// Team role resolved for the current viewer.
#[derive(Enum, Clone, Copy, PartialEq, Eq)]
pub enum GraphqlTeamRole {
    /// Team owner.
    Owner,
    /// Team administrator.
    Admin,
    /// Team member.
    Member,
}

impl From<TeamRole> for GraphqlTeamRole {
    fn from(value: TeamRole) -> Self {
        match value {
            TeamRole::Owner => Self::Owner,
            TeamRole::Admin => Self::Admin,
            TeamRole::Member => Self::Member,
        }
    }
}

/// Item-style permission represented by the viewer's effective access level.
#[derive(SimpleObject)]
pub struct GraphqlAccessLevelPermission {
    /// Effective access level held by the viewer.
    access_level: GraphqlEntityAccessLevel,
}

/// View-only channel permission without participant membership.
#[derive(SimpleObject)]
pub struct GraphqlChannelViewOnlyPermission {
    /// Whether the viewer is limited to view-only channel access.
    is_view_only: bool,
}

/// Channel permission represented by the viewer's participant role.
#[derive(SimpleObject)]
pub struct GraphqlChannelRolePermission {
    /// Channel participant role held by the viewer.
    role: GraphqlChannelParticipantRole,
}

/// Team permission represented by the viewer's membership role.
#[derive(SimpleObject)]
pub struct GraphqlTeamRolePermission {
    /// Team membership role held by the viewer.
    role: GraphqlTeamRole,
}

/// Permission held by the current viewer for an entity.
///
/// The concrete union member identifies whether access comes from an item
/// access level, view-only channel access, a channel role, or a team role.
#[derive(Union)]
pub enum GraphqlEntityPermission {
    /// Permission for item-based entities (document, chat, project, thread).
    AccessLevel(GraphqlAccessLevelPermission),
    /// View-only permission for a channel without an active participant role.
    ChannelViewOnly(GraphqlChannelViewOnlyPermission),
    /// Permission for channel-based entities with an active participant role.
    ChannelRole(GraphqlChannelRolePermission),
    /// Permission for team-based entities.
    TeamRole(GraphqlTeamRolePermission),
}

impl GraphqlEntityPermission {
    /// Convert a domain permission into its concrete GraphQL union member.
    fn new(permission: EntityPermission) -> Self {
        match permission {
            EntityPermission::AccessLevel { access_level } => {
                Self::AccessLevel(GraphqlAccessLevelPermission {
                    access_level: access_level.into(),
                })
            }
            EntityPermission::ChannelViewOnly => {
                Self::ChannelViewOnly(GraphqlChannelViewOnlyPermission { is_view_only: true })
            }
            EntityPermission::ChannelRole { role } => {
                Self::ChannelRole(GraphqlChannelRolePermission { role: role.into() })
            }
            EntityPermission::TeamRole { role } => {
                Self::TeamRole(GraphqlTeamRolePermission { role: role.into() })
            }
        }
    }
}

/// Permission reader used by GraphQL entity edges.
pub trait EntityPermissionEdgeReader: Send + Sync + 'static {
    /// Resolve permissions for the requested entities. Missing or inaccessible
    /// entities map to `None` instead of leaking their existence.
    fn get_entity_permissions<'a>(
        &'a self,
        user_id: &'a MacroUserIdStr<'static>,
        organization_id: Option<i64>,
        entities: Vec<Entity<'static>>,
    ) -> impl Future<
        Output = Result<HashMap<Entity<'static>, Option<EntityPermission>>, rootcause::Report>,
    > + Send
    + 'a;
}

impl<T> EntityPermissionEdgeReader for Arc<T>
where
    T: EntityAccessService,
{
    async fn get_entity_permissions(
        &self,
        user_id: &MacroUserIdStr<'static>,
        organization_id: Option<i64>,
        entities: Vec<Entity<'static>>,
    ) -> Result<HashMap<Entity<'static>, Option<EntityPermission>>, rootcause::Report> {
        let mut futures = Vec::with_capacity(entities.len());
        for entity in entities {
            futures.push(async move {
                let permission = self
                    .get_entity_permission(
                        Some(user_id),
                        &entity.entity_id,
                        entity.entity_type,
                        organization_id,
                    )
                    .await;
                (entity, permission)
            });
        }
        let permissions = stream::iter(futures)
            // A Soup page can contain many heterogeneous entities. Keep the edge
            // lazy and parallel, but do not let one request consume the whole DB
            // pool while the entity-access port has no bulk lookup yet.
            .buffer_unordered(16)
            .collect::<Vec<_>>()
            .await;

        let mut result = HashMap::with_capacity(permissions.len());
        for (entity, permission) in permissions {
            match permission {
                Ok(permission) => {
                    result.insert(entity, Some(permission));
                }
                Err(
                    AccessError::Unauthorized
                    | AccessError::UnauthorizedWithMessage(_)
                    | AccessError::NotFound(_),
                ) => {
                    result.insert(entity, None);
                }
                Err(error) => return Err(rootcause::report!(error).into()),
            }
        }
        Ok(result)
    }
}

/// Permission reader used by schema-only GraphQL construction.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoOpEntityPermissionEdgeReader;

impl EntityPermissionEdgeReader for NoOpEntityPermissionEdgeReader {
    async fn get_entity_permissions(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _organization_id: Option<i64>,
        entities: Vec<Entity<'static>>,
    ) -> Result<HashMap<Entity<'static>, Option<EntityPermission>>, rootcause::Report> {
        Ok(entities.into_iter().map(|entity| (entity, None)).collect())
    }
}

/// Request-scoped DataLoader for current-viewer entity permissions.
pub struct EntityPermissionLoader<R> {
    /// Authenticated viewer whose permissions are requested.
    user_id: MacroUserIdStr<'static>,
    /// Organization context used when resolving permissions.
    organization_id: Option<i64>,
    /// Domain-facing reader that resolves effective access.
    reader: R,
}

impl<R> EntityPermissionLoader<R> {
    /// Construct a permission loader for one authenticated viewer.
    pub fn new(user_id: MacroUserIdStr<'static>, organization_id: Option<i64>, reader: R) -> Self {
        Self {
            user_id,
            organization_id,
            reader,
        }
    }
}

impl<R> async_graphql::dataloader::Loader<OwnedEntity> for EntityPermissionLoader<R>
where
    R: EntityPermissionEdgeReader,
{
    type Value = Option<EntityPermission>;
    type Error = rootcause::Report<Dynamic, Cloneable>;

    async fn load(
        &self,
        keys: &[OwnedEntity],
    ) -> Result<HashMap<OwnedEntity, Self::Value>, Self::Error> {
        let entities = keys.iter().map(|key| key.as_entity().clone()).collect();
        self.reader
            .get_entity_permissions(&self.user_id, self.organization_id, entities)
            .await
            .map(|permissions| {
                permissions
                    .into_iter()
                    .map(|(entity, permission)| (OwnedEntity::from(entity), permission))
                    .collect()
            })
            .map_err(|error| error.into_cloneable())
    }
}

/// Build a permission DataLoader scoped to the authenticated viewer.
pub fn entity_permission_loader<R>(
    user_id: MacroUserIdStr<'static>,
    organization_id: Option<i64>,
    reader: R,
) -> DataLoader<EntityPermissionLoader<R>>
where
    R: EntityPermissionEdgeReader,
{
    DataLoader::new(
        EntityPermissionLoader::new(user_id, organization_id, reader),
        tokio::spawn,
    )
}

/// Resolve a typed current-viewer permission from GraphQL request data.
pub async fn load_entity_permission<R>(
    ctx: &Context<'_>,
    entity: Entity<'static>,
) -> async_graphql::Result<Option<GraphqlEntityPermission>>
where
    R: EntityPermissionEdgeReader,
{
    let loader = ctx.data::<DataLoader<EntityPermissionLoader<R>>>()?;
    Ok(loader
        .load_one(OwnedEntity::from(entity))
        .await?
        .flatten()
        .map(GraphqlEntityPermission::new))
}

use std::{collections::HashMap, sync::Arc};

use async_graphql::{Context, Enum, SimpleObject, dataloader::DataLoader};
use entity_access::domain::{
    models::{AccessError, AccessLevel, EntityPermission, ParticipantRole, TeamRole},
    ports::EntityAccessService,
};
use futures::{StreamExt, stream};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use rootcause::markers::{Cloneable, Dynamic};

/// Identity used to resolve the requesting user's permission for an entity.
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct EntityPermissionKey {
    /// Canonical entity type understood by the entity-access domain.
    pub entity_type: EntityType,
    /// Entity identifier.
    pub entity_id: String,
}

/// The shape of an entity permission.
#[derive(Enum, Clone, Copy, PartialEq, Eq)]
pub enum GraphqlEntityPermissionKind {
    /// Item-style view/comment/edit/owner access.
    AccessLevel,
    /// View-only channel access without active participant membership.
    ChannelViewOnly,
    /// Channel participant membership.
    ChannelRole,
    /// Team membership.
    TeamRole,
}

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

/// Permission held by the current viewer for an entity.
///
/// One of `accessLevel`, `channelRole`, or `teamRole` is populated as selected
/// by `kind`; view-only channel access has no accompanying role field.
#[derive(SimpleObject)]
pub struct GraphqlEntityPermission {
    /// The permission model represented by this value.
    kind: GraphqlEntityPermissionKind,
    /// Item access level when `kind` is `ACCESS_LEVEL`.
    access_level: Option<GraphqlEntityAccessLevel>,
    /// Channel participant role when `kind` is `CHANNEL_ROLE`.
    channel_role: Option<GraphqlChannelParticipantRole>,
    /// Team membership role when `kind` is `TEAM_ROLE`.
    team_role: Option<GraphqlTeamRole>,
}

impl From<EntityPermission> for GraphqlEntityPermission {
    fn from(value: EntityPermission) -> Self {
        match value {
            EntityPermission::AccessLevel { access_level } => Self {
                kind: GraphqlEntityPermissionKind::AccessLevel,
                access_level: Some(access_level.into()),
                channel_role: None,
                team_role: None,
            },
            EntityPermission::ChannelViewOnly => Self {
                kind: GraphqlEntityPermissionKind::ChannelViewOnly,
                access_level: None,
                channel_role: None,
                team_role: None,
            },
            EntityPermission::ChannelRole { role } => Self {
                kind: GraphqlEntityPermissionKind::ChannelRole,
                access_level: None,
                channel_role: Some(role.into()),
                team_role: None,
            },
            EntityPermission::TeamRole { role } => Self {
                kind: GraphqlEntityPermissionKind::TeamRole,
                access_level: None,
                channel_role: None,
                team_role: Some(role.into()),
            },
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
        keys: Vec<EntityPermissionKey>,
    ) -> impl Future<
        Output = Result<HashMap<EntityPermissionKey, Option<EntityPermission>>, rootcause::Report>,
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
        keys: Vec<EntityPermissionKey>,
    ) -> Result<HashMap<EntityPermissionKey, Option<EntityPermission>>, rootcause::Report> {
        let permissions = stream::iter(keys.into_iter().map(|key| async move {
            let permission = self
                .get_entity_permission(
                    Some(user_id),
                    &key.entity_id,
                    key.entity_type,
                    organization_id,
                )
                .await;
            (key, permission)
        }))
        // A Soup page can contain many heterogeneous entities. Keep the edge
        // lazy and parallel, but do not let one request consume the whole DB
        // pool while the entity-access port has no bulk lookup yet.
        .buffer_unordered(16)
        .collect::<Vec<_>>()
        .await;

        let mut result = HashMap::with_capacity(permissions.len());
        for (key, permission) in permissions {
            match permission {
                Ok(permission) => {
                    result.insert(key, Some(permission));
                }
                Err(
                    AccessError::Unauthorized
                    | AccessError::UnauthorizedWithMessage(_)
                    | AccessError::NotFound(_),
                ) => {
                    result.insert(key, None);
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
        keys: Vec<EntityPermissionKey>,
    ) -> Result<HashMap<EntityPermissionKey, Option<EntityPermission>>, rootcause::Report> {
        Ok(keys.into_iter().map(|key| (key, None)).collect())
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

impl<R> async_graphql::dataloader::Loader<EntityPermissionKey> for EntityPermissionLoader<R>
where
    R: EntityPermissionEdgeReader,
{
    type Value = Option<EntityPermission>;
    type Error = rootcause::Report<Dynamic, Cloneable>;

    async fn load(
        &self,
        keys: &[EntityPermissionKey],
    ) -> Result<HashMap<EntityPermissionKey, Self::Value>, Self::Error> {
        self.reader
            .get_entity_permissions(&self.user_id, self.organization_id, keys.to_vec())
            .await
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
    key: EntityPermissionKey,
) -> async_graphql::Result<Option<GraphqlEntityPermission>>
where
    R: EntityPermissionEdgeReader,
{
    let loader = ctx.data::<DataLoader<EntityPermissionLoader<R>>>()?;
    Ok(loader.load_one(key).await?.flatten().map(Into::into))
}

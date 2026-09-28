//! Sharing policy for persisted agent sessions.

use entity_access::domain::models::{
    EntityAccessReceipt, EntityType, OwnerAccessLevel, RequiredPermission, ViewAccessLevel,
};
use models_permissions::share_permission::{
    SharePermissionV2, UpdateSharePermissionRequestV2,
    access_level::AccessLevel,
    channel_share_permission::UpdateOperation,
    team_share::{
        AuthorizedTeamShareCommand, TeamShareFacts, TeamShareLevel, TeamShareRequest,
        authorize_team_share,
    },
};

use super::{
    error::{AgentSessionError, Result},
    model::AgentSessionId,
};

#[cfg(test)]
mod test;

/// Persistence capability for session sharing, independent of transport.
pub trait SessionSharingRepo: Send + Sync + 'static {
    /// Read canonical sharing settings and direct channel grants.
    fn permissions(
        &self,
        id: AgentSessionId,
    ) -> impl Future<Output = Result<SharePermissionV2>> + Send;

    /// Load actual ownership, team membership, and explicit sharing facts.
    fn team_share_facts(
        &self,
        id: AgentSessionId,
    ) -> impl Future<Output = Result<TeamShareFacts>> + Send;

    /// Atomically persist sharing settings and grants, rechecking team facts.
    fn update_permissions(
        &self,
        id: AgentSessionId,
        request: UpdateSharePermissionRequestV2,
        team_share: Option<AuthorizedTeamShareCommand>,
    ) -> impl Future<Output = Result<SharePermissionV2>> + Send;
}

/// Authorized use cases exposed to sharing adapters.
pub trait SessionSharing: Send + Sync + 'static {
    /// Read settings for a session the caller can view.
    fn permissions(
        &self,
        access: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<SharePermissionV2>> + Send;

    /// Change sharing only after owner access has been established.
    fn update_permissions(
        &self,
        access: &EntityAccessReceipt<OwnerAccessLevel>,
        request: UpdateSharePermissionRequestV2,
    ) -> impl Future<Output = Result<SharePermissionV2>> + Send;
}

/// Session-sharing service; policy lives here and storage remains behind its port.
pub struct SessionSharingService<R> {
    repo: R,
}

impl<R> SessionSharingService<R> {
    /// Construct sharing use cases over a repository.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

fn session_id<T: RequiredPermission>(access: &EntityAccessReceipt<T>) -> Result<AgentSessionId> {
    if access.entity().entity_type != EntityType::AgentSession {
        return Err(AgentSessionError::Forbidden);
    }
    let id = macro_uuid::Uuid::parse_str(&access.entity().entity_id)
        .map_err(|_| AgentSessionError::InvalidSharing("invalid agent session id"))?;
    Ok(AgentSessionId::new_from_uuid(id))
}

fn validate(request: &UpdateSharePermissionRequestV2) -> Result<()> {
    if request.link_share_access_level.flatten() == Some(AccessLevel::Owner) {
        return Err(AgentSessionError::InvalidSharing(
            "links cannot grant owner access",
        ));
    }
    for grant in request.channel_share_permissions.iter().flatten() {
        if macro_uuid::Uuid::parse_str(&grant.channel_id).is_err() {
            return Err(AgentSessionError::InvalidSharing("invalid channel id"));
        }
        if grant.access_level == Some(AccessLevel::Owner) {
            return Err(AgentSessionError::InvalidSharing(
                "channels cannot grant owner access",
            ));
        }
        if grant.operation != UpdateOperation::Remove && grant.access_level.is_none() {
            return Err(AgentSessionError::InvalidSharing(
                "channel access level is required",
            ));
        }
    }
    Ok(())
}

impl<R: SessionSharingRepo> SessionSharing for SessionSharingService<R> {
    async fn permissions(
        &self,
        access: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<SharePermissionV2> {
        self.repo.permissions(session_id(access)?).await
    }

    async fn update_permissions(
        &self,
        access: &EntityAccessReceipt<OwnerAccessLevel>,
        request: UpdateSharePermissionRequestV2,
    ) -> Result<SharePermissionV2> {
        let id = session_id(access)?;
        validate(&request)?;
        let permissions = self.repo.permissions(id).await?;
        if access.acting_user_id().map(|user| user.as_ref()) != Some(permissions.owner.as_str()) {
            return Err(AgentSessionError::Forbidden);
        }
        let team_share = if request.team_share_access_level.is_some() {
            let facts = self.repo.team_share_facts(id).await?;
            authorize_team_share(
                access.acting_user_id(),
                &facts,
                TeamShareRequest {
                    access_level: request.team_share_access_level,
                    legacy_enabled: None,
                },
                TeamShareLevel::View,
            )
            .map_err(AgentSessionError::TeamSharing)?
        } else {
            None
        };
        self.repo.update_permissions(id, request, team_share).await
    }
}

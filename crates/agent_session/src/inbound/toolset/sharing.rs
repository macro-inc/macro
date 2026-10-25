//! Session sharing tools use the same domain policy as the app.
use super::ReadAgentSessionContext;
use crate::domain::sharing::{SessionSharing, SessionSharingRepo};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::{
    models::{EntityType, OwnerAccessLevel, ViewAccessLevel},
    ports::EntityAccessService,
};
use models_permissions::share_permission::{
    LinkShare, UpdateSharePermissionRequestV2,
    access_level::AccessLevel,
    channel_share_permission::{UpdateChannelSharePermission, UpdateOperation},
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A share can be disabled or grant a non-owner permission.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionShareAccess {
    /// Disable this share.
    Off,
    /// View only.
    View,
    /// View and comment.
    Comment,
    /// Edit.
    Edit,
}

impl SessionShareAccess {
    fn level(self) -> Option<AccessLevel> {
        match self {
            Self::Off => None,
            Self::View => Some(AccessLevel::View),
            Self::Comment => Some(AccessLevel::Comment),
            Self::Edit => Some(AccessLevel::Edit),
        }
    }
}

/// Who an item's share link admits.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionLinkScope {
    /// Disable link sharing.
    Off,
    /// Anyone with the link.
    Public,
    /// Members of the owner's team with the link.
    Team,
}

/// One channel's grant to set or remove.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionSharingChannel {
    /// Channel id to share with or revoke.
    #[schemars(description = "Channel id to share with or revoke.")]
    pub channel_id: Uuid,
    /// Desired grant; off removes only this channel's grant.
    #[schemars(description = "Desired grant; off removes only this channel's grant.")]
    pub access: SessionShareAccess,
}

/// A channel's existing session access.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionChannelGrant {
    /// Channel identity.
    pub channel_id: String,
    /// Effective access granted through this share.
    pub access: AccessLevel,
}

/// Authoritative sharing settings after a read or mutation.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionSharingResponse {
    /// Session owner's principal.
    pub owner: String,
    /// Who the link admits, or off when disabled.
    pub link_scope: SessionLinkScope,
    /// Access through the enabled link.
    pub link_access: Option<AccessLevel>,
    /// Explicit access for the owner's team.
    pub team_access: Option<AccessLevel>,
    /// Explicit channel grants.
    pub channels: Vec<SessionChannelGrant>,
}
impl From<models_permissions::share_permission::SharePermissionV2> for SessionSharingResponse {
    fn from(value: models_permissions::share_permission::SharePermissionV2) -> Self {
        Self {
            owner: value.owner,
            link_scope: match value.link_share {
                None => SessionLinkScope::Off,
                Some(LinkShare::Public) => SessionLinkScope::Public,
                Some(LinkShare::Team) => SessionLinkScope::Team,
            },
            link_access: value.link_share_access_level,
            team_access: value.team_share_access_level,
            channels: value
                .channel_share_permissions
                .unwrap_or_default()
                .into_iter()
                .map(|grant| SessionChannelGrant {
                    channel_id: grant.channel_id,
                    access: grant.access_level,
                })
                .collect(),
        }
    }
}

/// Read the current link, team, and channel grants.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(
    title = "ReadAgentSessionSharing",
    description = "Read an agent session's current owner, link sharing, team access, and channel grants. Requires view access. Use UpdateAgentSessionSharing to change grants as the owner."
)]
pub struct ReadAgentSessionSharing {
    /// Session UUID.
    pub session_id: Uuid,
}
impl ToolAnnotated for ReadAgentSessionSharing {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read session sharing");
}

/// Change only the named sharing settings.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(
    title = "UpdateAgentSessionSharing",
    description = "Change an agent session's link, team, or channel sharing as its owner. Omitted settings remain unchanged; off revokes that grant. Requires an explicit user request to change sharing. Private persona conversations cannot be shared. Returns the resulting settings."
)]
pub struct UpdateAgentSessionSharing {
    /// Session UUID.
    pub session_id: Uuid,

    /// Who the share link admits.
    #[schemars(
        description = "Who the item's share link admits: public (anyone with the link), team (the owner's team members with the link), or off to disable link sharing."
    )]
    #[serde(default)]
    pub link_scope: Option<SessionLinkScope>,
    /// Permission granted by an enabled link.
    #[schemars(
        description = "Permission granted by an enabled share link. Off resets it to the default level."
    )]
    #[serde(default)]
    pub link_access: Option<SessionShareAccess>,
    /// Explicit owner-team grant.
    #[schemars(description = "Access for everyone on the owner's team; off removes it.")]
    #[serde(default)]
    pub team_access: Option<SessionShareAccess>,
    /// Channel grants to set or remove.
    #[schemars(
        description = "Individual channel grants to set or remove; other channel grants stay unchanged."
    )]
    #[serde(default)]
    pub channels: Option<Vec<SessionSharingChannel>>,
}
impl UpdateAgentSessionSharing {
    pub(super) fn policy(&self) -> UpdateSharePermissionRequestV2 {
        UpdateSharePermissionRequestV2 {
            link_share: self.link_scope.map(|scope| match scope {
                SessionLinkScope::Off => None,
                SessionLinkScope::Public => Some(LinkShare::Public),
                SessionLinkScope::Team => Some(LinkShare::Team),
            }),
            link_share_access_level: self.link_access.map(SessionShareAccess::level),
            team_share_access_level: self.team_access.map(SessionShareAccess::level),
            channel_share_permissions: self.channels.as_ref().map(|channels| {
                channels
                    .iter()
                    .map(|channel| UpdateChannelSharePermission {
                        operation: if channel.access == SessionShareAccess::Off {
                            UpdateOperation::Remove
                        } else {
                            UpdateOperation::Replace
                        },
                        channel_id: channel.channel_id.to_string(),
                        access_level: channel.access.level(),
                    })
                    .collect()
            }),
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.link_scope.is_none()
            && self.link_access.is_none()
            && self.team_access.is_none()
            && self.channels.as_ref().is_none_or(Vec::is_empty)
    }
}

impl ToolAnnotated for UpdateAgentSessionSharing {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Update session sharing").with_idempotent();
}

#[async_trait]
impl<R, A> AsyncTool<ReadAgentSessionContext<R, A>> for ReadAgentSessionSharing
where
    R: SessionSharingRepo + Clone + 'static,
    A: EntityAccessService,
{
    type Output = SessionSharingResponse;
    #[tracing::instrument(skip_all, fields(session_id = %self.session_id), err)]
    async fn call(
        &self,
        context: ServiceContext<ReadAgentSessionContext<R, A>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let access = context
            .access
            .generate_entity_access_receipt::<ViewAccessLevel>(
                &request.user_id,
                None,
                &self.session_id.to_string(),
                EntityType::AgentSession,
            )
            .await
            .map_err(|e| ToolCallError {
                description: "Unable to read session sharing.".into(),
                internal_error: e.into(),
            })?;
        let result = context
            .sharing
            .permissions(&access)
            .await
            .map_err(|e| ToolCallError {
                description: e.to_string(),
                internal_error: e.into(),
            })?;
        Ok(result.into())
    }
}
#[async_trait]
impl<R, A> AsyncTool<ReadAgentSessionContext<R, A>> for UpdateAgentSessionSharing
where
    R: SessionSharingRepo + Clone + 'static,
    A: EntityAccessService,
{
    type Output = SessionSharingResponse;
    #[tracing::instrument(skip_all, fields(session_id = %self.session_id), err)]
    async fn call(
        &self,
        context: ServiceContext<ReadAgentSessionContext<R, A>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        if self.is_empty() {
            return Err(ToolCallError {
                description: "Provide at least one sharing change.".into(),
                internal_error: anyhow::anyhow!("empty sharing update"),
            });
        }
        let access = context
            .access
            .generate_entity_access_receipt::<OwnerAccessLevel>(
                &request.user_id,
                None,
                &self.session_id.to_string(),
                EntityType::AgentSession,
            )
            .await
            .map_err(|e| ToolCallError {
                description: "You must own this session to change sharing.".into(),
                internal_error: e.into(),
            })?;
        let result = context
            .sharing
            .update_permissions(&access, self.policy())
            .await
            .map_err(|e| ToolCallError {
                description: e.to_string(),
                internal_error: e.into(),
            })?;
        Ok(result.into())
    }
}

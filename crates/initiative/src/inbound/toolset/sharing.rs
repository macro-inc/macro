//! Owner-only sharing updates, mirrored by the domain onto the description document.

use super::*;
use crate::domain::models::UpdateInitiativeRequest;
use ai_toolset::{AsyncTool, ServiceContext, ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::models::EditAccessLevel;
use models_permissions::share_permission::{
    LinkShare, UpdateSharePermissionRequestV2,
    access_level::AccessLevel,
    channel_share_permission::{UpdateChannelSharePermission, UpdateOperation},
};
use schemars::JsonSchema;
use serde::Deserialize;
use uuid::Uuid;

/// A share can be disabled or grant a non-owner permission.
#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProjectShareAccess {
    /// Disable this explicit share.
    Off,
    /// View only.
    View,
    /// View and comment.
    Comment,
    /// Edit.
    Edit,
}

impl ProjectShareAccess {
    fn level(self) -> Option<AccessLevel> {
        match self {
            Self::Off => None,
            Self::View => Some(AccessLevel::View),
            Self::Comment => Some(AccessLevel::Comment),
            Self::Edit => Some(AccessLevel::Edit),
        }
    }
}

/// Scope admitted by a project's share link.
#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProjectLinkScope {
    /// Disable link sharing.
    Off,
    /// Anyone with the link.
    Public,
    /// Owner-team members with the link.
    Team,
}

/// Update one channel's grant without replacing other channel grants.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChannelSharing {
    /// Channel id to share with or revoke.
    #[schemars(description = "Channel id to share with or revoke.")]
    pub channel_id: Uuid,
    /// Desired grant; off removes only this channel grant.
    #[schemars(description = "Desired grant; off removes only this channel grant.")]
    pub access: ProjectShareAccess,
}

/// Update project sharing, retaining domain-owned authorization.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "UpdateInitiativeSharing",
    description = "Change a project's team, link or channel sharing. Only the actual project owner may change sharing. Each omitted field remains unchanged; off disables that share. Project and description document permissions change together. Collaboration member changes use UpdateInitiative."
)]
pub struct UpdateInitiativeSharing {
    /// Project identifier.
    #[schemars(description = "Project identifier.")]
    pub initiative_id: Uuid,
    /// Explicit owner-team grant; off removes it.
    #[schemars(description = "Explicit owner-team grant; off removes it.")]
    pub team_access: Option<ProjectShareAccess>,
    /// Who the project link admits; off disables it.
    #[schemars(description = "Who the project link admits; off disables it.")]
    pub link_scope: Option<ProjectLinkScope>,
    /// Permission granted by an enabled link. Off resets it to the default view level.
    #[schemars(
        description = "Permission granted by an enabled link. Off resets it to the default view level."
    )]
    pub link_access: Option<ProjectShareAccess>,
    /// Individual channel shares to set or remove; other shares remain unchanged.
    #[schemars(
        description = "Individual channel shares to set or remove; other shares remain unchanged."
    )]
    pub channels: Option<Vec<ProjectChannelSharing>>,
}

impl ToolAnnotated for UpdateInitiativeSharing {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Change project sharing").with_idempotent();
}

#[async_trait]
impl<S: InitiativeService, A: EntityAccessService, R: EntityActivityReads>
    AsyncTool<InitiativeToolContext<S, A, R>> for UpdateInitiativeSharing
{
    type Output = ProjectDetails;
    async fn call(
        &self,
        context: ServiceContext<InitiativeToolContext<S, A, R>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let receipt = context
            .receipt::<EditAccessLevel>(
                &request,
                &self.initiative_id.to_string(),
                EntityType::Initiative,
            )
            .await?;
        context
            .service
            .update(
                receipt,
                UpdateInitiativeRequest {
                    share_permission: Some(UpdateSharePermissionRequestV2 {
                        team_share_access_level: self.team_access.map(ProjectShareAccess::level),
                        link_share: self.link_scope.map(|scope| match scope {
                            ProjectLinkScope::Off => None,
                            ProjectLinkScope::Public => Some(LinkShare::Public),
                            ProjectLinkScope::Team => Some(LinkShare::Team),
                        }),
                        link_share_access_level: self.link_access.map(ProjectShareAccess::level),
                        channel_share_permissions: self.channels.as_ref().map(|channels| {
                            channels
                                .iter()
                                .map(|channel| UpdateChannelSharePermission {
                                    operation: if matches!(channel.access, ProjectShareAccess::Off)
                                    {
                                        UpdateOperation::Remove
                                    } else {
                                        UpdateOperation::Replace
                                    },
                                    channel_id: channel.channel_id.to_string(),
                                    access_level: channel.access.level(),
                                })
                                .collect()
                        }),
                    }),
                    ..Default::default()
                },
            )
            .await
            .map(Into::into)
            .map_err(failure)
    }
}

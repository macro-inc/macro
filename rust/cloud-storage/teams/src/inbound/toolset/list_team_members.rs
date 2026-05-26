//! ListTeamMembers tool for reading the caller's team members.

use super::TeamToolContext;
use crate::domain::{
    model::{TeamInviteDetails, TeamMember},
    team_repo::TeamMembersService,
};
use ai::tool::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use entity_access::domain::{
    models::{
        AccessError, Entity, EntityAccessReceipt, EntityPermission, EntityType, MemberTeamRole,
    },
    ports::EntityAccessService,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// A current team member returned by [`ListTeamMembers`].
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolTeamMember {
    /// The user's Macro user id.
    pub user_id: String,
    /// The user's role in the team.
    pub role: String,
}

impl From<TeamMember<'static>> for ToolTeamMember {
    fn from(member: TeamMember<'static>) -> Self {
        Self {
            user_id: member.user_id.to_string(),
            role: member.role.to_string(),
        }
    }
}

/// A pending team invite returned by [`ListTeamMembers`].
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolTeamInvite {
    /// The invited email address.
    pub email: String,
    /// The role the invited user will receive.
    pub role: String,
}

impl From<TeamInviteDetails> for ToolTeamInvite {
    fn from(invite: TeamInviteDetails) -> Self {
        Self {
            email: invite.email,
            role: invite.team_role.to_string(),
        }
    }
}

/// Response from [`ListTeamMembers`].
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListTeamMembersResponse {
    /// Current accepted team members.
    pub members: Vec<ToolTeamMember>,
    /// Pending team invites.
    pub invited: Vec<ToolTeamInvite>,
}

/// List current and invited members of the caller's team.
#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[schemars(
    title = "ListTeamMembers",
    description = "List the current members and pending invites for the authenticated user's team. Requires the caller to be a team member."
)]
#[allow(unused)]
// empty structs can't be deserialized;
pub struct ListTeamMembers {}

#[async_trait]
impl<TSvc, ESvc> AsyncTool<TeamToolContext<TSvc, ESvc>> for ListTeamMembers
where
    TSvc: TeamMembersService,
    ESvc: EntityAccessService,
{
    type Output = ListTeamMembersResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<TeamToolContext<TSvc, ESvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("List team members");

        let entity_access_receipt = team_member_receipt(&service_context, request_context).await?;

        let team_members = service_context
            .service
            .list_team_members(entity_access_receipt)
            .await
            .map_err(|e| ToolCallError {
                description: "unable to list team members".to_string(),
                internal_error: e.into(),
            })?;

        Ok(ListTeamMembersResponse {
            members: team_members.members.into_iter().map(Into::into).collect(),
            invited: team_members.invited.into_iter().map(Into::into).collect(),
        })
    }
}

async fn team_member_receipt<TSvc, ESvc>(
    service_context: &ServiceContext<TeamToolContext<TSvc, ESvc>>,
    request_context: RequestContext,
) -> Result<EntityAccessReceipt<MemberTeamRole>, ToolCallError>
where
    TSvc: TeamMembersService,
    ESvc: EntityAccessService,
{
    let team_info = service_context
        .entity_access_service
        .get_user_team(&request_context.user_id)
        .await
        .map_err(team_access_error)?;

    let Some(team_info) = team_info else {
        return Err(ToolCallError {
            description: "user is not in a team".to_string(),
            internal_error: anyhow::anyhow!("user is not in a team"),
        });
    };

    EntityAccessReceipt::try_new_authenticated_user(
        request_context.user_id,
        Entity {
            entity_id: team_info.team_id.to_string(),
            entity_type: EntityType::Team,
        },
        EntityPermission::TeamRole {
            role: team_info.role,
        },
    )
    .map_err(team_access_error)
}

fn team_access_error(err: AccessError) -> ToolCallError {
    let description = match err {
        AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
            "user is not a member of a team"
        }
        AccessError::NotFound(_) => "team not found",
        AccessError::BadRequest(_) => "invalid team membership",
        AccessError::DatabaseError(_) | AccessError::Internal => "failed to verify team membership",
    };

    ToolCallError {
        description: description.to_string(),
        internal_error: err.into(),
    }
}

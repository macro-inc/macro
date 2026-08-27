use super::{
    ChannelToolContext, channel_mutation_error, channel_name, parse_participants,
    participant_id_strings,
};
use crate::domain::models::{ChannelType, CreateChannelRequest, Sender};
use crate::domain::ports::ChannelService;
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use uuid::Uuid;

/// Channel types an agent may create.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum NewChannelType {
    /// Invite-only channel with no team.
    Private,
    /// Channel owned by the caller's current team.
    Team,
}

impl NewChannelType {
    fn to_domain(self) -> ChannelType {
        match self {
            Self::Private => ChannelType::Private,
            Self::Team => ChannelType::Team,
        }
    }
}

/// Response from [`CreateChannel`].
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateChannelResponse {
    /// Created channel id.
    pub channel_id: Uuid,
    /// Trimmed channel name.
    pub name: String,
    /// Channel type that was created.
    pub channel_type: NewChannelType,
    /// Canonical participant ids sent with the create request.
    pub participants: Vec<String>,
    /// Human-readable result summary.
    pub summary: String,
}

/// Create a private or team channel and add its first members.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "CreateChannel",
    description = "Create a private or team channel and add its first members. Use `private` for an invite-only channel and `team` for a channel owned by the current user's team. Do not use this for a direct message — those are created separately. Team id is resolved from the current user; do not invent one. Participants accept `macro|<email>` ids from ListTeamMembers or bare emails. Creating a team channel when the user has no team fails; create a private channel instead. Creating a team channel with no participants adds the current user so the channel is valid. Use only when the user asks to create a channel."
)]
pub struct CreateChannel {
    /// Channel display name.
    #[schemars(description = "Display name for the new channel.")]
    pub name: String,
    /// Private or team.
    #[schemars(
        description = "Use `private` for an invite-only channel or `team` for the current user's team."
    )]
    pub channel_type: NewChannelType,
    /// First members, excluding implicit owner insertion performed by the domain.
    #[schemars(
        description = "People to add, as `macro|<email>` ids or bare emails. Defaults to none. A team channel with an empty list adds the current user."
    )]
    #[serde(default)]
    pub participants: Vec<String>,
}

impl ToolAnnotated for CreateChannel {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Create channel");
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<ChannelToolContext<Svc, AccessSvc>> for CreateChannel
where
    Svc: ChannelService,
    AccessSvc: EntityAccessService,
{
    type Output = CreateChannelResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ChannelToolContext<Svc, AccessSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let name = channel_name(&self.name)?;
        let mut participants = parse_participants(&self.participants)?;
        let team_id = match self.channel_type {
            NewChannelType::Private => None,
            NewChannelType::Team => {
                let team = service_context
                    .entity_access_service
                    .get_user_team(&request_context.user_id)
                    .await
                    .map_err(team_lookup_error)?;
                let team = team.ok_or_else(|| ToolCallError {
                    description:
                        "you are not a member of a team — create a private channel instead"
                            .to_string(),
                    internal_error: anyhow::anyhow!("create team channel without a team"),
                })?;
                if participants.is_empty() {
                    participants.push(request_context.user_id.clone());
                }
                Some(team.team_id)
            }
        };

        let participant_ids = participant_id_strings(&participants);
        let response = service_context
            .service
            .create_channel(
                Sender::new_from_user(request_context.user_id.clone()),
                None,
                CreateChannelRequest {
                    name: Some(name.clone()),
                    channel_type: self.channel_type.to_domain(),
                    team_id,
                    auto_join_team: false,
                    participants: HashSet::from_iter(participants),
                },
            )
            .await
            .map_err(|error| channel_mutation_error("create the channel", error))?;

        let channel_id = Uuid::parse_str(&response.id).map_err(|error| ToolCallError {
            description: "created channel id was not a valid uuid".to_string(),
            internal_error: error.into(),
        })?;
        let kind = match self.channel_type {
            NewChannelType::Private => "private",
            NewChannelType::Team => "team",
        };

        Ok(CreateChannelResponse {
            channel_id,
            name: name.clone(),
            channel_type: self.channel_type,
            participants: participant_ids,
            summary: format!("Created the {kind} channel `{name}`."),
        })
    }
}

fn team_lookup_error(error: entity_access::domain::models::AccessError) -> ToolCallError {
    ToolCallError {
        description: "failed to resolve the current user's team".to_string(),
        internal_error: error.into(),
    }
}

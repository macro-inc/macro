use super::{
    ChannelToolContext, channel_mutation_error, parse_participants, participant_id_strings,
    user_sender,
};
use crate::domain::models::{AddParticipantsRequest, RemoveParticipantsRequest};
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

/// Membership change to apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ParticipantAction {
    /// Add or reactivate members.
    Add,
    /// Remove members.
    Remove,
}

/// Response from [`ManageChannelParticipants`].
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ManageChannelParticipantsResponse {
    /// Channel whose membership changed.
    pub channel_id: Uuid,
    /// Applied membership change.
    pub action: ParticipantAction,
    /// Canonical participant ids that were requested.
    pub participants: Vec<String>,
    /// Human-readable result summary.
    pub summary: String,
}

/// Add or remove people from a channel.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ManageChannelParticipants",
    description = "Add or remove members of an existing channel. Requires the current user to be a channel member. Direct-message channels cannot change membership. The channel owner cannot be removed. Participants accept `macro|<email>` ids from ListTeamMembers or bare emails. Use `add` to invite people and `remove` to take them out. Use only when the user asks to change who is in a channel."
)]
pub struct ManageChannelParticipants {
    /// Channel to change.
    #[schemars(description = "Channel id whose membership should change.")]
    pub channel_id: Uuid,
    /// Add or remove.
    #[schemars(description = "Use `add` to invite people or `remove` to take them out.")]
    pub action: ParticipantAction,
    /// People to add or remove.
    #[schemars(
        description = "People to add or remove, as `macro|<email>` ids or bare emails. Must not be empty."
    )]
    pub participants: Vec<String>,
}

impl ToolAnnotated for ManageChannelParticipants {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Change channel members");
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<ChannelToolContext<Svc, AccessSvc>> for ManageChannelParticipants
where
    Svc: ChannelService,
    AccessSvc: EntityAccessService,
{
    type Output = ManageChannelParticipantsResponse;

    #[tracing::instrument(
        skip_all,
        fields(
            user_id=?request_context.user_id,
            channel_id=%self.channel_id,
            action=?self.action
        ),
        err
    )]
    async fn call(
        &self,
        service_context: ServiceContext<ChannelToolContext<Svc, AccessSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        if self.participants.is_empty() {
            return Err(ToolCallError {
                description: "participants must not be empty — pass at least one user id or email"
                    .to_string(),
                internal_error: anyhow::anyhow!("empty channel participant list"),
            });
        }

        let participants = parse_participants(&self.participants)?;
        let receipt = service_context
            .require_channel_member_role(&request_context, self.channel_id)
            .await?;
        let actor = user_sender(&receipt)?;
        let participant_ids = participant_id_strings(&participants);

        match self.action {
            ParticipantAction::Add => service_context
                .service
                .add_participants(
                    actor,
                    self.channel_id,
                    AddParticipantsRequest {
                        participants: HashSet::from_iter(participants),
                    },
                )
                .await
                .map_err(|error| channel_mutation_error("add channel participants", error))?,
            ParticipantAction::Remove => service_context
                .service
                .remove_participants(
                    actor,
                    self.channel_id,
                    RemoveParticipantsRequest {
                        participants: participant_ids.clone(),
                    },
                )
                .await
                .map_err(|error| channel_mutation_error("remove channel participants", error))?,
        }

        let count = participant_ids.len();
        let noun = if count == 1 { "member" } else { "members" };
        let summary = match self.action {
            ParticipantAction::Add => format!("Added {count} {noun} to the channel."),
            ParticipantAction::Remove => format!("Removed {count} {noun} from the channel."),
        };

        Ok(ManageChannelParticipantsResponse {
            channel_id: self.channel_id,
            action: self.action,
            participants: participant_ids,
            summary,
        })
    }
}

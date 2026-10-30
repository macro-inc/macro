use super::{ChannelToolContext, channel_mutation_error, parse_participants};
use crate::domain::{
    models::{GetOrCreateAction, GetOrCreateDmRequest, GetOrCreatePrivateRequest, Sender},
    ports::ChannelService,
};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Response from [`OpenDirectMessage`].
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OpenDirectMessageResponse {
    /// The direct-message channel.
    pub channel_id: Uuid,
    /// Whether the conversation was newly created.
    pub created: bool,
    /// Canonical ids of the other participants.
    pub participants: Vec<String>,
    /// Human-readable result summary.
    pub summary: String,
}

/// Find or start the user's direct-message conversation with other people.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "OpenDirectMessage",
    description = "Find the user's direct-message conversation with one or more people, creating it if it does not exist yet, and return its channel id. One person opens a 1:1 DM; several open a group DM with exactly that set of people. Use this before SendChannelMessage when the user asks to message someone directly and no channel id is known. Find people with ListTeamMembers."
)]
pub struct OpenDirectMessage {
    /// Other participants.
    #[schemars(
        description = "The other people in the conversation, as Macro user ids (`macro|<email>`) or emails. Do not include the user."
    )]
    pub participants: Vec<String>,
}

impl ToolAnnotated for OpenDirectMessage {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::additive("Open direct message").with_idempotent();
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<ChannelToolContext<Svc, AccessSvc>> for OpenDirectMessage
where
    Svc: ChannelService,
    AccessSvc: EntityAccessService,
{
    type Output = OpenDirectMessageResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ChannelToolContext<Svc, AccessSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let user_id = request_context.user_id.clone();
        let participants: Vec<_> = parse_participants(&self.participants)?
            .into_iter()
            .filter(|participant| participant.as_ref() != user_id.as_ref())
            .collect();
        let actor = crate::domain::models::Sender::new_from_user(user_id);
        let response = match participants.as_slice() {
            [] => {
                return Err(ToolCallError {
                    description: "participants must name at least one person other than the user"
                        .to_string(),
                    internal_error: anyhow::anyhow!("no direct message recipients"),
                });
            }
            [recipient] => service_context
                .service
                .get_or_create_dm(
                    actor,
                    GetOrCreateDmRequest {
                        recipient_id: Sender::new_from_user(recipient.clone()),
                    },
                )
                .await
                .map_err(|error| channel_mutation_error("open the direct message", error))?,
            _ => service_context
                .service
                .get_or_create_private(
                    actor,
                    GetOrCreatePrivateRequest {
                        recipients: participants.iter().cloned().collect(),
                    },
                )
                .await
                .map_err(|error| channel_mutation_error("open the group message", error))?,
        };
        let channel_id = Uuid::parse_str(&response.channel_id).map_err(|error| ToolCallError {
            description: "failed to open the direct message".to_string(),
            internal_error: error.into(),
        })?;
        let created = matches!(response.action, GetOrCreateAction::Create);
        let participants = super::participant_id_strings(&participants);
        let summary = format!(
            "{} the conversation with {}.",
            if created { "Started" } else { "Found" },
            participants.join(", ")
        );

        Ok(OpenDirectMessageResponse {
            channel_id,
            created,
            participants,
            summary,
        })
    }
}

use super::{ChannelToolContext, channel_mutation_error, channel_name, user_sender};
use crate::domain::models::PatchChannelRequest;
use crate::domain::ports::ChannelService;
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Response from [`RenameChannel`].
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RenameChannelResponse {
    /// Channel that was renamed.
    pub channel_id: Uuid,
    /// New trimmed name.
    pub name: String,
    /// Previous display name when it could be read.
    pub previous_name: Option<String>,
    /// Human-readable result summary.
    pub summary: String,
}

/// Rename an existing channel.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "RenameChannel",
    description = "Rename an existing channel. Requires the current user to be a channel admin or owner. Direct-message channels cannot be renamed. Use only when the user asks to rename a channel."
)]
pub struct RenameChannel {
    /// Channel to rename.
    #[schemars(description = "Channel id to rename.")]
    pub channel_id: Uuid,
    /// New display name.
    #[schemars(description = "New display name for the channel.")]
    pub name: String,
}

impl ToolAnnotated for RenameChannel {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Rename channel");
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<ChannelToolContext<Svc, AccessSvc>> for RenameChannel
where
    Svc: ChannelService,
    AccessSvc: EntityAccessService,
{
    type Output = RenameChannelResponse;

    #[tracing::instrument(
        skip_all,
        fields(user_id=?request_context.user_id, channel_id=%self.channel_id),
        err
    )]
    async fn call(
        &self,
        service_context: ServiceContext<ChannelToolContext<Svc, AccessSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let name = channel_name(&self.name)?;
        let receipt = service_context
            .require_channel_admin(&request_context, self.channel_id)
            .await?;
        let actor = user_sender(&receipt)?;
        let previous_name = service_context
            .service
            .get_channel_metadata(self.channel_id, request_context.user_id.clone())
            .await
            .ok()
            .map(|metadata| metadata.channel_name);

        service_context
            .service
            .patch_channel(
                actor,
                self.channel_id,
                PatchChannelRequest {
                    channel_name: Some(name.clone()),
                    convert_to_team_channel: None,
                    auto_join_team: None,
                },
            )
            .await
            .map_err(|error| channel_mutation_error("rename the channel", error))?;

        let summary = match previous_name.as_deref() {
            Some(previous) => format!("Renamed the channel from `{previous}` to `{name}`."),
            None => format!("Renamed the channel to `{name}`."),
        };

        Ok(RenameChannelResponse {
            channel_id: self.channel_id,
            name,
            previous_name,
            summary,
        })
    }
}

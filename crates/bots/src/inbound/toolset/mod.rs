//! AI tools for bot management.

mod configure_bot;
mod create_bot;
mod delete_bot;
mod get_bot_webhooks;
mod issue_bot_credential;
mod list_bots;
mod manage_bot_channel_access;
mod types;

#[cfg(test)]
mod test;

use crate::domain::ports::{BotError, BotService};
use ai_toolset::{AsyncToolCollection, RequestContext, ToolCallError};
use configure_bot::ConfigureBot;
use create_bot::CreateBot;
use delete_bot::DeleteBot;
use entity_access::domain::{
    models::{AccessError, EntityAccessReceipt, EntityType, MemberParticipantRole},
    ports::EntityAccessService,
};
use get_bot_webhooks::GetBotWebhooks;
use issue_bot_credential::IssueBotCredential;
use list_bots::ListBots;
use manage_bot_channel_access::ManageBotChannelAccess;
use std::sync::Arc;
use uuid::Uuid;

pub use types::{
    BOT_WEBHOOK_SCOPE, BOT_WEBHOOK_SCOPE_HEADER, BOT_WEBHOOK_TOKEN_HEADER, BotOwnerSummary,
    BotSummary, BotWebhook, CreatedBotChannelSetup,
};

/// Dependencies shared by bot-management AI tools.
pub struct BotToolContext<Svc, AccessSvc>
where
    Svc: BotService,
    AccessSvc: EntityAccessService,
{
    /// Bot domain service. Ownership and team-administration policy live here.
    pub service: Arc<Svc>,
    /// Entity access service used to verify channel membership at the edge.
    pub entity_access_service: Arc<AccessSvc>,
    /// Public document-storage service base URL used to construct webhook URLs.
    pub document_storage_service_url: String,
}

impl<Svc, AccessSvc> Clone for BotToolContext<Svc, AccessSvc>
where
    Svc: BotService,
    AccessSvc: EntityAccessService,
{
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            document_storage_service_url: self.document_storage_service_url.clone(),
        }
    }
}

impl<Svc, AccessSvc> BotToolContext<Svc, AccessSvc>
where
    Svc: BotService,
    AccessSvc: EntityAccessService,
{
    /// Create a bot tool context.
    pub fn new(
        service: Svc,
        entity_access_service: AccessSvc,
        document_storage_service_url: String,
    ) -> Self {
        Self {
            service: Arc::new(service),
            entity_access_service: Arc::new(entity_access_service),
            document_storage_service_url: document_storage_service_url
                .trim_end_matches('/')
                .to_string(),
        }
    }

    /// Verify that the request user is an active member of a channel.
    pub async fn require_channel_member(
        &self,
        request_context: &RequestContext,
        channel_id: Uuid,
    ) -> Result<EntityAccessReceipt<MemberParticipantRole>, ToolCallError> {
        self.entity_access_service
            .generate_entity_access_receipt::<MemberParticipantRole>(
                &request_context.user_id,
                None,
                &channel_id.to_string(),
                EntityType::Channel,
            )
            .await
            .map_err(channel_access_error)
    }
}

fn channel_access_error(error: AccessError) -> ToolCallError {
    let description = match error {
        AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
            "you must be a member of the channel to manage its bots"
        }
        AccessError::NotFound(_) => "channel not found",
        AccessError::BadRequest(_) => "invalid channel id",
        AccessError::DatabaseError(_) | AccessError::Internal => {
            "failed to verify channel membership"
        }
    };

    ToolCallError {
        description: description.to_string(),
        internal_error: error.into(),
    }
}

fn bot_tool_error(action: &'static str, error: BotError) -> ToolCallError {
    let description = match &error {
        BotError::BadRequest(message) | BotError::NotFound(message) => message.clone(),
        BotError::Unauthorized => {
            "you do not have permission to manage this bot or its owning team".to_string()
        }
        BotError::Repo(_) => format!("failed to {action}"),
    };

    ToolCallError {
        description,
        internal_error: error.into(),
    }
}

/// Create the bot-management AI toolset.
pub fn bot_toolset<Svc, AccessSvc>() -> AsyncToolCollection<BotToolContext<Svc, AccessSvc>>
where
    Svc: BotService,
    AccessSvc: EntityAccessService,
{
    AsyncToolCollection::new()
        .add_tool::<ListBots, BotToolContext<Svc, AccessSvc>>()
        .add_tool::<CreateBot, BotToolContext<Svc, AccessSvc>>()
        .add_tool::<IssueBotCredential, BotToolContext<Svc, AccessSvc>>()
        .add_tool::<GetBotWebhooks, BotToolContext<Svc, AccessSvc>>()
        .add_tool::<ManageBotChannelAccess, BotToolContext<Svc, AccessSvc>>()
        .add_tool::<ConfigureBot, BotToolContext<Svc, AccessSvc>>()
        .add_tool::<DeleteBot, BotToolContext<Svc, AccessSvc>>()
}

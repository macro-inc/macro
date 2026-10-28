//! IssueBotCredential tool.

use super::{BotToolContext, bot_tool_error};
use crate::domain::{models::BotId, ports::BotService};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Response describing a credential the user can mint from the chat card.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct IssueBotCredentialResponse {
    /// Bot receiving the credential.
    pub bot_id: Uuid,
    /// Optional credential label.
    pub label: Option<String>,
    /// Optional expiration time.
    pub expires_at: Option<DateTime<Utc>>,
    /// Human-readable result summary.
    pub summary: String,
}

/// Propose a new secret credential for a manageable bot without minting it.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "IssueBotCredential",
    description = "Prepare a new bot credential for a bot the current user can manage. This does not mint the secret. Tell the user to click the chat card or open bot settings to create the token. The secret is shown only while that card is open. Use this when the user asks for bot credentials or a webhook token; existing raw secrets cannot be recovered safely."
)]
pub struct IssueBotCredential {
    /// Bot to issue a credential for.
    #[schemars(description = "Bot id from CreateBot or ListBots.")]
    pub bot_id: Uuid,
    /// Optional identifying label.
    #[schemars(
        description = "Optional label describing where the credential will be used, such as `github-webhook`."
    )]
    #[serde(default)]
    pub label: Option<String>,
    /// Optional expiry.
    #[schemars(
        description = "Optional RFC 3339 expiration timestamp. Omit for a credential without a scheduled expiration."
    )]
    #[serde(default)]
    pub expires_at: Option<DateTime<Utc>>,
}

impl ToolAnnotated for IssueBotCredential {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Issue bot credential");
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<BotToolContext<Svc, AccessSvc>> for IssueBotCredential
where
    Svc: BotService,
    AccessSvc: EntityAccessService,
{
    type Output = IssueBotCredentialResponse;

    #[tracing::instrument(
        skip_all,
        fields(user_id=?request_context.user_id, bot_id=%self.bot_id),
        err
    )]
    async fn call(
        &self,
        service_context: ServiceContext<BotToolContext<Svc, AccessSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        service_context
            .service
            .get_bot(request_context.user_id, BotId::new_from_uuid(self.bot_id))
            .await
            .map_err(|error| bot_tool_error("issue bot credential", error))?;

        Ok(IssueBotCredentialResponse {
            bot_id: self.bot_id,
            label: self.label.clone(),
            expires_at: self.expires_at,
            summary: "Credential is ready to mint. Click the card or open bot settings to create a token. The secret is shown only while that card is open.".to_string(),
        })
    }
}

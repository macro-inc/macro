//! IssueBotCredential tool.

use super::{BotToolContext, bot_tool_error};
use crate::domain::{
    models::{BotId, CreateBotTokenRequest},
    ports::BotService,
};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Response containing a newly issued bot credential.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct IssueBotCredentialResponse {
    /// Bot receiving the credential.
    pub bot_id: Uuid,
    /// Token metadata id, used to revoke this credential through the bot API.
    pub token_id: Uuid,
    /// Raw bearer token. It is returned only when minted and must be stored securely.
    pub bearer_token: String,
    /// Optional credential label.
    pub label: Option<String>,
    /// Optional expiration time.
    pub expires_at: Option<DateTime<Utc>>,
    /// Human-readable result summary.
    pub summary: String,
}

/// Mint a new secret credential for a manageable bot.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "IssueBotCredential",
    description = "Mint a new secret bearer token for a bot the current user can manage. Use this when the user asks for bot credentials or a webhook token; existing raw secrets cannot be recovered safely. The response contains a newly issued bearerToken and tokenId. Treat bearerToken as sensitive and tell the user to store it securely because it is shown only once."
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
        let response = service_context
            .service
            .create_token(
                request_context.user_id,
                BotId::new_from_uuid(self.bot_id),
                CreateBotTokenRequest {
                    label: self.label.clone(),
                    expires_at: self.expires_at,
                },
            )
            .await
            .map_err(|error| bot_tool_error("issue bot credential", error))?;

        Ok(IssueBotCredentialResponse {
            bot_id: self.bot_id,
            token_id: response.token.id,
            bearer_token: response.bearer_token,
            label: response.token.label,
            expires_at: response.token.expires_at,
            summary: "Issued a new bot credential. Store the bearer token securely; it will not be shown again."
                .to_string(),
        })
    }
}

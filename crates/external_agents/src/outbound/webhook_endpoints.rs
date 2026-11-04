//! External agent endpoints as webhooks, pushed through the webhook queue.
//!
//! An agent's endpoint is an ordinary webhook in its owner's workspace, so
//! pushes get the webhook pipeline's signing, retries, and delivery records.
//! Its filter names the agent's own event, which no broker topic carries:
//! only [`AgentEndpoints::push`] queues anything for it.

#[cfg(test)]
mod test;

use bot_id::BotId;
use bots::domain::models::BotOwner;
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use rate_limit::RateLimitService;
use webhook::domain::{
    models::{
        CreateWebhookRequest, NormalizedWebhookEvent, PatchWebhookRequest, Webhook,
        WebhookEventQueueMessage, WebhookFilter, WebhookScope,
    },
    ports::{WebhookError, WebhookEventEnqueuer, WebhookService},
};
use webhook::inbound::axum_router::{
    validate_webhook_rate_limit, validate_webhook_rate_limit_key,
};

use crate::domain::models::{
    AgentEndpoint, ExternalAgentEvent, MESSAGE_EVENT_SCHEMA_VERSION, MESSAGE_EVENT_TYPE,
};
use crate::domain::ports::{
    AgentEndpoints, CreatedEndpoint, EndpointCheck, ExternalAgentError, Result,
};

/// Entity type of an external agent's events in webhook delivery records.
const EVENT_ENTITY_TYPE: &str = "bot";

/// The filter an agent's endpoint is created with: its own events.
pub fn agent_filter(bot_id: BotId) -> WebhookFilter {
    WebhookFilter {
        events: vec![MESSAGE_EVENT_TYPE.to_owned()],
        ids: Some(vec![bot_id.to_string()]),
    }
}

/// The queued delivery of `event`, keyed and ordered by its agent.
pub fn queued_event(
    webhook_id: &str,
    event: &ExternalAgentEvent,
) -> Result<WebhookEventQueueMessage> {
    let broker_envelope = serde_json::to_value(event.envelope())
        .map_err(|error| ExternalAgentError::Internal(rootcause::report!(error).into()))?;
    let bot_id = event.bot_id.to_string();
    Ok(WebhookEventQueueMessage::new(
        webhook_id.to_owned(),
        NormalizedWebhookEvent {
            event_id: event.id.to_string(),
            schema_version: MESSAGE_EVENT_SCHEMA_VERSION,
            event_name: MESSAGE_EVENT_TYPE.to_owned(),
            entity_type: EVENT_ENTITY_TYPE.to_owned(),
            entity_id: bot_id.clone(),
            ordering_key: bot_id,
            occurred_at: Utc::now(),
            broker_envelope,
        },
    ))
}

/// Namespace of an agent's endpoint webhook, unique within its workspace.
fn namespace(bot_id: BotId) -> String {
    format!("external-agent:{bot_id}")
}

fn endpoint(webhook: &Webhook) -> AgentEndpoint {
    AgentEndpoint {
        webhook_id: webhook.id.clone(),
        url: webhook.endpoint_url.clone(),
        verified: webhook.is_valid,
    }
}

fn webhook_error(error: WebhookError) -> ExternalAgentError {
    match error {
        WebhookError::BadRequest(message) | WebhookError::Conflict(message) => {
            ExternalAgentError::BadRequest(message)
        }
        WebhookError::Unauthorized => ExternalAgentError::Unauthorized,
        WebhookError::NotFound(_) => ExternalAgentError::NotFound,
        WebhookError::Repo(error) => ExternalAgentError::Internal(rootcause::report!("{error:#}")),
    }
}

/// [`AgentEndpoints`] over the webhook domain. Validation requests are
/// limited exactly as the webhook API limits them.
#[derive(Clone)]
pub struct WebhookAgentEndpoints<W, Q, L> {
    webhooks: W,
    queue: Q,
    rate_limiter: L,
}

impl<W, Q, L> WebhookAgentEndpoints<W, Q, L> {
    /// Compose the webhook service, its delivery queue, and the validation
    /// rate limiter.
    pub fn new(webhooks: W, queue: Q, rate_limiter: L) -> Self {
        Self {
            webhooks,
            queue,
            rate_limiter,
        }
    }
}

impl<W, Q, L> AgentEndpoints for WebhookAgentEndpoints<W, Q, L>
where
    W: WebhookService,
    Q: WebhookEventEnqueuer,
    L: RateLimitService,
{
    #[tracing::instrument(skip(self, caller, owner, name, url), err)]
    async fn create(
        &self,
        caller: MacroUserIdStr<'static>,
        owner: &BotOwner,
        bot_id: BotId,
        name: &str,
        url: String,
    ) -> Result<CreatedEndpoint> {
        let scope = match owner {
            BotOwner::User { .. } => WebhookScope::User,
            BotOwner::Team { .. } => WebhookScope::Team,
        };
        let webhook = self
            .webhooks
            .create_webhook(
                caller.clone(),
                CreateWebhookRequest {
                    scope,
                    namespace: namespace(bot_id),
                    name: format!("{name} (external agent)"),
                    endpoint_url: url,
                    headers: None,
                    filters: vec![agent_filter(bot_id)],
                },
            )
            .await
            .map_err(webhook_error)?;
        // Team scope resolves to the caller's current team, which must be the
        // agent's, or its owners could not manage the endpoint.
        if let BotOwner::Team { team_id } = owner
            && webhook.workspace_id != team_id.to_string()
        {
            self.webhooks
                .delete_webhook(caller, webhook.id)
                .await
                .map_err(webhook_error)?;
            return Err(ExternalAgentError::BadRequest(
                "a team agent's endpoint must be registered from that team".to_owned(),
            ));
        }
        Ok(CreatedEndpoint {
            endpoint: endpoint(&webhook),
            signing_secret: webhook.signing_secret,
        })
    }

    #[tracing::instrument(skip(self, caller), err)]
    async fn get(
        &self,
        caller: MacroUserIdStr<'static>,
        webhook_id: &str,
    ) -> Result<Option<AgentEndpoint>> {
        match self.webhooks.get_webhook(caller, webhook_id.to_owned()).await {
            Ok(webhook) => Ok(Some(endpoint(&webhook))),
            Err(WebhookError::NotFound(_)) => Ok(None),
            Err(error) => Err(webhook_error(error)),
        }
    }

    #[tracing::instrument(skip(self, caller, url), err)]
    async fn set_url(
        &self,
        caller: MacroUserIdStr<'static>,
        webhook_id: &str,
        url: String,
    ) -> Result<AgentEndpoint> {
        let webhook = self
            .webhooks
            .patch_webhook(
                caller,
                webhook_id.to_owned(),
                PatchWebhookRequest {
                    name: None,
                    endpoint_url: Some(url),
                    headers: None,
                    filters: None,
                    status: None,
                },
            )
            .await
            .map_err(webhook_error)?;
        Ok(endpoint(&webhook))
    }

    #[tracing::instrument(skip(self, caller), err)]
    async fn verify(
        &self,
        caller: MacroUserIdStr<'static>,
        webhook_id: &str,
    ) -> Result<EndpointCheck> {
        self.rate_limiter
            .check_rate_limit(
                validate_webhook_rate_limit_key(caller.as_ref(), webhook_id),
                validate_webhook_rate_limit(),
            )
            .await
            .map_err(ExternalAgentError::Internal)?
            .map_err(|_| {
                ExternalAgentError::BadRequest(
                    "too many verification attempts; try again later".to_owned(),
                )
            })?;
        let checked = self
            .webhooks
            .validate_webhook(caller, webhook_id.to_owned())
            .await
            .map_err(webhook_error)?;
        Ok(EndpointCheck {
            verified: checked.is_valid,
            response_status: checked.response_status,
            message: checked.message,
        })
    }

    #[tracing::instrument(skip(self, caller), err)]
    async fn delete(&self, caller: MacroUserIdStr<'static>, webhook_id: &str) -> Result<()> {
        match self
            .webhooks
            .delete_webhook(caller, webhook_id.to_owned())
            .await
        {
            Ok(()) | Err(WebhookError::NotFound(_)) => Ok(()),
            Err(error) => Err(webhook_error(error)),
        }
    }

    #[tracing::instrument(skip(self, event), fields(event_id = %event.id), err)]
    async fn push(&self, webhook_id: &str, event: &ExternalAgentEvent) -> Result<()> {
        self.queue
            .enqueue(queued_event(webhook_id, event)?)
            .await
            .map_err(|error| {
                ExternalAgentError::Internal(rootcause::report!("{:#}", error.into()))
            })
    }
}

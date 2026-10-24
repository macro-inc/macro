//! A routine's own webhook URL: any service can POST JSON to it, and a
//! `webhook.received` filter decides whether the routine runs.
//!
//! The URL's secret is the only credential, so it is shown once and kept
//! only as a SHA-256. A delivery runs nothing but the routine it belongs to.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, OwnerAccessLevel};
use macro_uuid::Uuid;
use rootcause::Report;
use serde::Serialize;
use serde_json::Value;
use utoipa::ToSchema;

use super::event_runs::WebhookEventAdmission;
use super::event_trigger::EventReference;
use super::models::ActionPolicyError;
use super::ports::ScheduledActionRepo;
use super::service::granted_action;

pub mod token;

#[cfg(test)]
mod test;

/// Largest body a webhook URL accepts, in bytes.
pub const MAX_WEBHOOK_BODY_BYTES: usize = 64 * 1024;

/// A routine's webhook URL, without its secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutineWebhook {
    /// The start of the token, enough to recognize it.
    pub token_prefix: String,
    pub created_at: DateTime<Utc>,
}

/// A newly issued webhook URL token. The token is never available again.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct IssuedRoutineWebhook {
    /// Secret path segment: POST to `/scheduled-actions/webhooks/{token}`.
    pub token: String,
    #[serde(flatten)]
    pub webhook: RoutineWebhook,
}

/// What became of a delivery.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutineWebhookDelivery {
    #[schema(value_type = String, format = Uuid)]
    pub event_id: Uuid,
    /// Whether the routine will run for it. False when the routine is paused,
    /// has no webhook trigger, or its payload match left the delivery out.
    pub queued: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum RoutineWebhookError {
    #[error("routine not found")]
    NotFound,
    #[error("unknown webhook URL")]
    UnknownToken,
    #[error("{0}")]
    Internal(Report),
}

impl From<anyhow::Error> for RoutineWebhookError {
    fn from(error: anyhow::Error) -> Self {
        match error.downcast_ref::<ActionPolicyError>() {
            Some(ActionPolicyError::NotFound) => Self::NotFound,
            _ => Self::Internal(rootcause::report!("{error:#}")),
        }
    }
}

impl From<Report> for RoutineWebhookError {
    fn from(error: Report) -> Self {
        Self::Internal(error)
    }
}

/// Webhook URL storage. One URL per routine; issuing replaces the last.
pub trait RoutineWebhookRepository: Send + Sync + 'static {
    fn replace(
        &self,
        action_id: Uuid,
        token_prefix: &str,
        token_hash: &[u8; 32],
    ) -> impl Future<Output = Result<RoutineWebhook, Report>> + Send;

    fn get(
        &self,
        action_id: Uuid,
    ) -> impl Future<Output = Result<Option<RoutineWebhook>, Report>> + Send;

    /// The routine a token belongs to.
    fn find_action(
        &self,
        token_hash: &[u8; 32],
    ) -> impl Future<Output = Result<Option<Uuid>, Report>> + Send;

    fn delete(&self, action_id: Uuid) -> impl Future<Output = Result<(), Report>> + Send;
}

/// What the HTTP adapter calls.
pub trait RoutineWebhooks: Send + Sync + 'static {
    fn issue(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<IssuedRoutineWebhook, RoutineWebhookError>> + Send;

    fn get(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<Option<RoutineWebhook>, RoutineWebhookError>> + Send;

    /// Stop the URL working. Deleting the routine does too.
    fn revoke(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<(), RoutineWebhookError>> + Send;

    /// Queue a run of the URL's routine if its webhook trigger matches.
    fn deliver(
        &self,
        token: &str,
        payload: Value,
    ) -> impl Future<Output = Result<RoutineWebhookDelivery, RoutineWebhookError>> + Send;
}

pub struct RoutineWebhookService<W, R, I> {
    webhooks: W,
    actions: Arc<R>,
    admission: Arc<I>,
}

impl<W, R, I> RoutineWebhookService<W, R, I>
where
    R: ScheduledActionRepo,
{
    pub fn new(webhooks: W, actions: Arc<R>, admission: Arc<I>) -> Self {
        Self {
            webhooks,
            actions,
            admission,
        }
    }

    async fn owned_action_id(
        &self,
        receipt: &EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<Uuid, RoutineWebhookError> {
        let action = granted_action(self.actions.as_ref(), receipt).await?;
        action.id.ok_or(RoutineWebhookError::NotFound)
    }
}

impl<W, R, I> RoutineWebhooks for RoutineWebhookService<W, R, I>
where
    W: RoutineWebhookRepository,
    R: ScheduledActionRepo,
    I: WebhookEventAdmission,
{
    async fn issue(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<IssuedRoutineWebhook, RoutineWebhookError> {
        let action_id = self.owned_action_id(&receipt).await?;
        let token = token::generate();
        let webhook = self
            .webhooks
            .replace(action_id, &token::prefix(&token), &token::hash(&token))
            .await?;
        Ok(IssuedRoutineWebhook { token, webhook })
    }

    async fn get(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<Option<RoutineWebhook>, RoutineWebhookError> {
        let action_id = self.owned_action_id(&receipt).await?;
        Ok(self.webhooks.get(action_id).await?)
    }

    async fn revoke(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), RoutineWebhookError> {
        let action_id = self.owned_action_id(&receipt).await?;
        Ok(self.webhooks.delete(action_id).await?)
    }

    #[tracing::instrument(
        name = "routine.webhook_delivery",
        skip_all,
        fields(action_id, event_id, queued),
        err
    )]
    async fn deliver(
        &self,
        token: &str,
        payload: Value,
    ) -> Result<RoutineWebhookDelivery, RoutineWebhookError> {
        let action_id = self
            .webhooks
            .find_action(&token::hash(token))
            .await?
            .ok_or(RoutineWebhookError::UnknownToken)?;
        let event = EventReference::webhook(action_id, payload);
        let event_id = event.event_id().as_uuid();
        let span = tracing::Span::current();
        span.record("action_id", tracing::field::display(action_id));
        span.record("event_id", tracing::field::display(event_id));
        let queued = self.admission.admit_webhook(&event).await?;
        span.record("queued", queued);
        Ok(RoutineWebhookDelivery { event_id, queued })
    }
}

//! A routine's webhook URL: a secret that starts the routine with whatever
//! text is POSTed to it. A delivery is one of the routine's events, admitted
//! to that routine alone, so it runs, queues and is recorded like any other.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, OwnerAccessLevel};
use macro_uuid::Uuid;
use rootcause::{Report, compat::IntoRootcause};
use serde::Serialize;
use utoipa::ToSchema;

use super::event_runs::{CurrentOwnerAccess, EventRunRepository, admission::EventAdmissionService};
use super::event_trigger::{EventId, EventReference, WebhookBodyError, WebhookDelivery};
use super::models::ActionPolicyError;
use super::ports::ScheduledActionRepo;
use super::service::granted_action;

mod token;

pub use token::WebhookToken;

#[cfg(test)]
mod test;

/// Deliveries that may wait to run at once. A routine runs one at a time;
/// past this, a sender is told to slow down rather than queue more work for
/// its owner.
pub const MAX_QUEUED_DELIVERIES: u32 = 20;

/// The URL a routine has. Its token is never shown again after it is made.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutineWebhook {
    pub routine_id: Uuid,
    /// The token's first characters, to tell URLs apart.
    pub token_prefix: String,
    pub created_at: DateTime<Utc>,
}

/// A new URL, with the token it carries, shown only here.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatedRoutineWebhook {
    pub webhook: RoutineWebhook,
    /// The secret: `POST /scheduled-actions/webhooks/{token}` starts the routine.
    pub token: String,
}

#[derive(Debug, thiserror::Error)]
pub enum RoutineWebhookError {
    #[error("routine not found")]
    RoutineNotFound,
    #[error("this routine has no webhook URL")]
    NoWebhook,
    #[error("no routine has this webhook URL")]
    UnknownUrl,
    #[error("event-trigger management is not enabled")]
    Disabled,
    #[error("the routine is paused or doesn't run on webhooks")]
    NotListening,
    #[error("the routine already has {MAX_QUEUED_DELIVERIES} webhook deliveries waiting to run")]
    Backlogged,
    #[error(transparent)]
    Body(#[from] WebhookBodyError),
    #[error("routine webhook storage failed")]
    Internal(Report),
}

/// Where a routine's URL is kept, by the token's hash.
pub trait RoutineWebhookRepo: Send + Sync + 'static {
    /// Give the routine this token, replacing any it had.
    fn replace(
        &self,
        routine_id: Uuid,
        token_hash: [u8; 32],
        token_prefix: &str,
    ) -> impl Future<Output = Result<RoutineWebhook, Report>> + Send;

    fn get(
        &self,
        routine_id: Uuid,
    ) -> impl Future<Output = Result<Option<RoutineWebhook>, Report>> + Send;

    fn delete(&self, routine_id: Uuid) -> impl Future<Output = Result<(), Report>> + Send;

    /// The routine whose URL carries the token with this hash.
    fn routine_for(
        &self,
        token_hash: [u8; 32],
    ) -> impl Future<Output = Result<Option<Uuid>, Report>> + Send;

    /// The routine's webhook deliveries still waiting to start.
    fn queued_deliveries(
        &self,
        routine_id: Uuid,
    ) -> impl Future<Output = Result<u32, Report>> + Send;
}

/// Puts a delivery in its routine's queue.
pub trait WebhookAdmission: Send + Sync + 'static {
    /// False when the routine doesn't take it now.
    fn admit_webhook(
        &self,
        event: &EventReference,
    ) -> impl Future<Output = Result<bool, Report>> + Send;
}

impl<R: EventRunRepository, A: CurrentOwnerAccess> WebhookAdmission
    for EventAdmissionService<R, A>
{
    async fn admit_webhook(&self, event: &EventReference) -> Result<bool, Report> {
        EventAdmissionService::admit_webhook(self, event).await
    }
}

/// Managing a routine's URL, and taking what is sent to it.
pub trait RoutineWebhooks: Send + Sync + 'static {
    /// Give the routine a new URL. Its old one, if any, stops working.
    fn create(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<CreatedRoutineWebhook, RoutineWebhookError>> + Send;

    fn get(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<RoutineWebhook, RoutineWebhookError>> + Send;

    /// Stop the routine's URL working; a routine without one is left as it is.
    fn delete(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<(), RoutineWebhookError>> + Send;

    /// Queue a run of the routine whose URL carries `token`, with `body` as
    /// its event. Anyone with the URL may call it; nothing here says which
    /// routine a wrong token was near.
    fn deliver(
        &self,
        token: &str,
        body: &[u8],
        content_type: Option<&str>,
    ) -> impl Future<Output = Result<EventId, RoutineWebhookError>> + Send;
}

pub struct RoutineWebhookService<Actions, Webhooks, Admission> {
    actions: Arc<Actions>,
    webhooks: Arc<Webhooks>,
    admission: Arc<Admission>,
    /// Event routines are on: their worker runs deliveries.
    enabled: bool,
}

impl<Actions, Webhooks, Admission> RoutineWebhookService<Actions, Webhooks, Admission>
where
    Actions: ScheduledActionRepo,
    Webhooks: RoutineWebhookRepo,
    Admission: WebhookAdmission,
{
    pub fn new(
        actions: Arc<Actions>,
        webhooks: Arc<Webhooks>,
        admission: Arc<Admission>,
        enabled: bool,
    ) -> Self {
        Self {
            actions,
            webhooks,
            admission,
            enabled,
        }
    }

    /// The routine a receipt names, when its user owns it.
    async fn owned_routine(
        &self,
        receipt: &EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<Uuid, RoutineWebhookError> {
        match granted_action(self.actions.as_ref(), receipt).await {
            Ok(action) => action.id.ok_or_else(|| {
                RoutineWebhookError::Internal(rootcause::report!("unsaved routine"))
            }),
            Err(error) => match error.downcast_ref::<ActionPolicyError>() {
                Some(ActionPolicyError::NotFound) => Err(RoutineWebhookError::RoutineNotFound),
                _ => Err(RoutineWebhookError::Internal(error.into_rootcause())),
            },
        }
    }
}

impl<Actions, Webhooks, Admission> RoutineWebhooks
    for RoutineWebhookService<Actions, Webhooks, Admission>
where
    Actions: ScheduledActionRepo,
    Webhooks: RoutineWebhookRepo,
    Admission: WebhookAdmission,
{
    #[tracing::instrument(name = "routine.webhook_create", skip_all, err, fields(action_id))]
    async fn create(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<CreatedRoutineWebhook, RoutineWebhookError> {
        if !self.enabled {
            return Err(RoutineWebhookError::Disabled);
        }
        let routine_id = self.owned_routine(&receipt).await?;
        tracing::Span::current().record("action_id", tracing::field::display(routine_id));
        let token = WebhookToken::generate();
        let webhook = self
            .webhooks
            .replace(routine_id, token.hash(), token.prefix())
            .await
            .map_err(RoutineWebhookError::Internal)?;
        Ok(CreatedRoutineWebhook {
            webhook,
            token: token.as_str().to_owned(),
        })
    }

    async fn get(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<RoutineWebhook, RoutineWebhookError> {
        let routine_id = self.owned_routine(&receipt).await?;
        self.webhooks
            .get(routine_id)
            .await
            .map_err(RoutineWebhookError::Internal)?
            .ok_or(RoutineWebhookError::NoWebhook)
    }

    async fn delete(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), RoutineWebhookError> {
        let routine_id = self.owned_routine(&receipt).await?;
        self.webhooks
            .delete(routine_id)
            .await
            .map_err(RoutineWebhookError::Internal)
    }

    #[tracing::instrument(
        name = "routine.webhook_delivery",
        skip_all,
        err,
        fields(action_id, body_bytes = body.len(), event_id)
    )]
    async fn deliver(
        &self,
        token: &str,
        body: &[u8],
        content_type: Option<&str>,
    ) -> Result<EventId, RoutineWebhookError> {
        let token = WebhookToken::parse(token).ok_or(RoutineWebhookError::UnknownUrl)?;
        let routine_id = self
            .webhooks
            .routine_for(token.hash())
            .await
            .map_err(RoutineWebhookError::Internal)?
            .ok_or(RoutineWebhookError::UnknownUrl)?;
        let span = tracing::Span::current();
        span.record("action_id", tracing::field::display(routine_id));
        if !self.enabled {
            return Err(RoutineWebhookError::NotListening);
        }
        let delivery = WebhookDelivery::new(routine_id, body, content_type)?;
        let queued = self
            .webhooks
            .queued_deliveries(routine_id)
            .await
            .map_err(RoutineWebhookError::Internal)?;
        if queued >= MAX_QUEUED_DELIVERIES {
            return Err(RoutineWebhookError::Backlogged);
        }
        let event = EventReference::webhook(delivery);
        span.record(
            "event_id",
            tracing::field::display(event.event_id().as_uuid()),
        );
        if !self
            .admission
            .admit_webhook(&event)
            .await
            .map_err(RoutineWebhookError::Internal)?
        {
            return Err(RoutineWebhookError::NotListening);
        }
        Ok(event.event_id())
    }
}

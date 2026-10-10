//! PostgreSQL and provider adapters for scheduled email delivery.
use crate::outbound::email_api::GmailApi;
use crate::util::gmail::send::{
    attachment_snapshot::prepare_delivery_attachments, cleanup_draft_attachments,
    generate_email_threading_headers,
};
use anyhow::Context;
use chrono::Utc;
use email::domain::events::{EmailEventOrigin, EmailMacroEvent, MessageSentMetadata};
use email::domain::scheduled_delivery::{
    ClaimedDelivery, DELIVERY_LEASE_SECONDS, DeliveryMode, DeliveryPause,
    PREPARATION_RETRY_SECONDS, PreparationError, RECONCILIATION_DELAY_SECONDS,
    ScheduledDeliveryRepo, ScheduledMessageSender, SubmissionError,
    attachments::{ApprovedAttachments, AttachmentSnapshotMismatch},
};
use email::domain::send_attempt::{PreparedSendContentUnavailable, SendSnapshot};
use email_api_client::domain::models::{EmailApiError, PreparedSendMessage, SendRequest, SentIds};
use email_db_client::messages::scheduled::delivery::{self, DeliveryClaim};
use macro_event_broker::{KafkaEventPublisher, MacroEventBroker, MacroEventBrokerService};
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::{attachment::AttachmentDraft, link::Link, message::MessageToSend};
use tokio_util::task::TaskTracker;
use uuid::Uuid;

mod content;

/// Concrete worker adapters, wired by the scheduled worker's composition root.
pub struct ScheduledDeliveryAdapter {
    pub db: sqlx::PgPool,
    pub email_api: GmailApi,
    pub s3_client: s3_client::S3,
    pub attachment_bucket: String,
    pub macro_event_broker: MacroEventBrokerService<KafkaEventPublisher, TaskTracker>,
}

/// Context obtained only by winning an atomic database claim.
pub struct ScheduledClaim {
    link: Link,
    delivery: DeliveryClaim,
}

/// Provider result and attachment cleanup data retained until DB completion.
pub struct SentDelivery {
    message: MessageToSend,
    attachments: Option<Vec<AttachmentDraft>>,
}

impl ScheduledDeliveryRepo for ScheduledDeliveryAdapter {
    type Claim = ScheduledClaim;
    type Sent = SentDelivery;

    async fn try_claim(
        &self,
        link_id: Uuid,
        message_id: Uuid,
    ) -> anyhow::Result<Option<ClaimedDelivery<ScheduledClaim>>> {
        let Some(link) = email_db_client::links::get::fetch_link_by_id(&self.db, link_id).await?
        else {
            return Ok(None);
        };
        Ok(
            delivery::claim_delivery(&self.db, link_id, message_id, DELIVERY_LEASE_SECONDS)
                .await?
                .map(|delivery| ClaimedDelivery {
                    mode: if delivery.requires_reconciliation {
                        DeliveryMode::Reconcile
                    } else {
                        DeliveryMode::Send
                    },
                    claim: ScheduledClaim { link, delivery },
                }),
        )
    }

    async fn begin_send(&self, claim: &ScheduledClaim) -> anyhow::Result<bool> {
        delivery::begin_submission(&self.db, &claim.delivery, DELIVERY_LEASE_SECONDS).await
    }

    async fn release(&self, claim: &ScheduledClaim) -> anyhow::Result<()> {
        delivery::release_preparation(&self.db, &claim.delivery, PREPARATION_RETRY_SECONDS).await
    }

    async fn pause(&self, claim: &ScheduledClaim, reason: DeliveryPause) -> anyhow::Result<()> {
        delivery::pause_delivery(
            &self.db,
            &claim.delivery,
            reason == DeliveryPause::Unconfirmed,
            RECONCILIATION_DELAY_SECONDS,
        )
        .await
    }

    async fn complete(&self, claim: &ScheduledClaim, sent: SentDelivery) -> anyhow::Result<()> {
        let ctx = self;
        let link = &claim.link;
        let data = &claim.delivery.schedule;
        let scheduled_message = &claim.delivery.schedule;
        let mut message_to_send = sent.message;
        let db_attachments = sent.attachments;
        let mut tx = ctx
            .db
            .begin()
            .await
            .context("Failed to begin transaction")?;

        email_db_client::threads::provider_identity::lock_provider_thread(
            tx.as_mut(),
            link.id,
            message_to_send
                .provider_thread_id
                .as_deref()
                .context("provider accepted send without a thread ID")?,
        )
        .await?;
        if !delivery::complete_delivery(tx.as_mut(), &claim.delivery).await? {
            return Ok(());
        }
        let result = process_sent_message(tx.as_mut(), &mut message_to_send).await;

        match result {
            Ok(_) => {
                tx.commit().await.context("Failed to commit transaction")?;

                // Gmail accepted the send and the DB updates are committed:
                // publish the message_sent event resolving the earlier
                // message_send_queued. The actor was persisted on the scheduled
                // row at enqueue time; rows from before actor tracking decode to
                // `None` (no attribution).
                let actor = scheduled_message
                    .actor_id
                    .as_deref()
                    .and_then(|raw| MacroUserIdStr::parse_from_str(raw).ok())
                    .map(|actor| actor.into_owned());
                if let (Some(message_db_id), Some(thread_db_id)) =
                    (message_to_send.db_id, message_to_send.thread_db_id)
                {
                    let _ = ctx
                        .macro_event_broker
                        .send_event(&EmailMacroEvent::message_sent(MessageSentMetadata {
                            link_id: link.id,
                            owner: link.macro_id.clone(),
                            actor,
                            message_id: message_db_id,
                            thread_id: thread_db_id,
                            provider_message_id: message_to_send
                                .provider_id
                                .clone()
                                .unwrap_or_default(),
                            provider_thread_id: message_to_send
                                .provider_thread_id
                                .clone()
                                .unwrap_or_default(),
                            subject: Some(message_to_send.subject.clone()),
                            to_emails: message_to_send
                                .to
                                .iter()
                                .flatten()
                                .map(|c| c.email.clone())
                                .collect(),
                            cc_emails: message_to_send
                                .cc
                                .iter()
                                .flatten()
                                .map(|c| c.email.clone())
                                .collect(),
                            origin: EmailEventOrigin::UserAction,
                            sent_at: Utc::now(),
                        }))
                        .inspect_err(
                            |error| tracing::error!(error=?error, "failed to publish email event"),
                        );
                }

                // Cleanup attachments in the background after successful send
                if let (Some(draft_id), Some(attachments)) = (message_to_send.db_id, db_attachments)
                {
                    let db = ctx.db.clone();
                    let s3_client = ctx.s3_client.clone();
                    let bucket = ctx.attachment_bucket.clone();
                    let link_id = link.id;
                    tokio::spawn(async move {
                        cleanup_draft_attachments(
                            db,
                            &s3_client,
                            bucket,
                            link_id,
                            draft_id,
                            attachments,
                        )
                        .await;
                    });
                }
            }
            Err(e) => {
                if let Err(rollback_err) = tx.rollback().await {
                    tracing::error!(
                        error = ?rollback_err,
                        link_id = ?data.link_id,
                        message_id = ?data.message_id,
                        "Failed to rollback transaction after marking messages as sent failure"
                    );
                }
                return Err(e);
            }
        }

        Ok(())
    }
}

/// Fully prepared MIME and persistence data; contains no provider side effects.
pub struct PreparedDelivery {
    provider: PreparedSendMessage,
    delivery: SentDelivery,
}

impl ScheduledMessageSender<ScheduledClaim, SentDelivery> for ScheduledDeliveryAdapter {
    type Prepared = PreparedDelivery;

    async fn prepare(&self, claim: &ScheduledClaim) -> Result<PreparedDelivery, PreparationError> {
        self.prepare_delivery(claim)
            .await
            .map_err(classify_preparation_error)
    }

    async fn send_prepared(
        &self,
        _: &ScheduledClaim,
        mut prepared: PreparedDelivery,
    ) -> Result<SentDelivery, SubmissionError> {
        let ids = self
            .email_api
            .send_prepared(&prepared.provider)
            .await
            .map_err(classify_submission_error)?;
        apply_sent_ids(&mut prepared.delivery.message, ids);
        Ok(prepared.delivery)
    }

    async fn reconcile(&self, claim: &ScheduledClaim) -> anyhow::Result<Option<SentDelivery>> {
        let Some(header) = claim.delivery.message_id_header.as_deref() else {
            return Ok(None);
        };
        let Some(ids) = self
            .email_api
            .find_sent_message(claim.link.id, header)
            .await?
        else {
            return Ok(None);
        };
        let (mut message, _) = email_db_client::messages::get::get_message_to_send(
            &self.db,
            claim.delivery.schedule.message_id,
            claim.link.id,
        )
        .await?;
        apply_sent_ids(&mut message, ids);
        // Reconciliation loads cleanup metadata only, never attachment bytes.
        let attachments = email_db_client::attachments::draft::fetch_draft_attachments_by_draft_id(
            &self.db,
            claim.link.id,
            claim.delivery.schedule.message_id,
        )
        .await?;
        Ok(Some(SentDelivery {
            message,
            attachments: Some(attachments),
        }))
    }
}

impl ScheduledDeliveryAdapter {
    async fn prepare_delivery(&self, claim: &ScheduledClaim) -> anyhow::Result<PreparedDelivery> {
        let data = &claim.delivery.schedule;
        let (mut message, sender_contact) =
            content::load_delivery_content(&self.db, &claim.delivery)
                .await
                .context("failed to load scheduled message")?;
        let (parent_message_id, references) =
            generate_email_threading_headers(&self.db, message.replying_to_id, data.link_id).await;
        let approved = claim
            .delivery
            .approved_snapshot
            .as_ref()
            .map(|snapshot| serde_json::from_value::<SendSnapshot>(snapshot.clone()))
            .transpose()?
            .as_ref()
            .map(ApprovedAttachments::from)
            .unwrap_or(serde_json::from_value(
                claim.delivery.approved_attachments.clone(),
            )?);
        let attachments = prepare_delivery_attachments(
            &self.db,
            &self.s3_client,
            &self.email_api,
            &self.attachment_bucket,
            &claim.link,
            &mut message,
            Some(&approved),
        )
        .await?;
        let request = SendRequest {
            message: message.clone(),
            from: sender_contact,
            parent_message_id,
            references,
            message_id: claim.delivery.message_id_header.clone(),
        };
        let provider = self
            .email_api
            .prepare_send(
                claim.link.id,
                &request,
                message.provider_thread_id.as_deref(),
            )
            .await?;
        // The opaque provider request owns MIME, so raw attachment buffers need
        // not be retained while the provider call is in flight.
        message.attachments = None;
        Ok(PreparedDelivery {
            provider,
            delivery: SentDelivery {
                message,
                attachments,
            },
        })
    }
}

fn classify_preparation_error(error: anyhow::Error) -> PreparationError {
    if error.is::<AttachmentSnapshotMismatch>()
        || error.is::<PreparedSendContentUnavailable>()
        || error.downcast_ref::<EmailApiError>().is_some_and(|error| {
            matches!(
                error,
                EmailApiError::AuthRequired
                    | EmailApiError::Forbidden
                    | EmailApiError::NotFound
                    | EmailApiError::Conflict
                    | EmailApiError::SendRejected { .. }
                    | EmailApiError::Permanent { .. }
            )
        })
    {
        PreparationError::Failed(error)
    } else {
        PreparationError::Retry(error)
    }
}

fn classify_submission_error(error: EmailApiError) -> SubmissionError {
    // Transport failures, server failures, and malformed success responses
    // cannot establish that Gmail refused delivery.
    match error {
        EmailApiError::AuthRequired
        | EmailApiError::Forbidden
        | EmailApiError::NotFound
        | EmailApiError::Conflict
        | EmailApiError::SendRejected { .. }
        | EmailApiError::RateLimited { .. } => SubmissionError::Rejected(error.into()),
        _ => SubmissionError::Uncertain(error.into()),
    }
}

fn apply_sent_ids(message: &mut MessageToSend, sent_ids: SentIds) {
    message.provider_id = Some(sent_ids.provider_message_id);
    message.provider_thread_id = Some(sent_ids.provider_thread_id);
}

/// Mark both the scheduled message and the regular message as sent, and update thread metadata
///
/// This function handles all database updates in a single transaction
#[expect(
    clippy::useless_asref,
    reason = "We actually need the as_mut so we don't transfer ownership of the transaction"
)]
#[tracing::instrument(
    skip(tx, message),
    fields(
        message_db_id = message.db_id.unwrap().to_string(),
        link_id = message.link_id.to_string()
    ),
    err
)]
async fn process_sent_message(
    tx: &mut sqlx::PgConnection,
    message: &mut MessageToSend,
) -> anyhow::Result<()> {
    email_db_client::messages::sent_identity::reconcile_message(
        tx.as_mut(),
        message.link_id,
        message.db_id.context("sent message has no local ID")?,
        message
            .provider_id
            .as_deref()
            .context("sent message has no provider ID")?,
    )
    .await?;

    let thread_db_id = email_db_client::threads::provider_identity::reconcile_sent_thread(
        tx.as_mut(),
        message.link_id,
        message.db_id.context("sent message has no local ID")?,
        message
            .provider_thread_id
            .as_deref()
            .context("sent message has no provider thread ID")?,
    )
    .await?;
    message.thread_db_id = Some(thread_db_id);
    // mark message as non-draft
    email_db_client::messages::update::mark_message_as_sent(
        tx.as_mut(),
        &message.provider_id.clone().unwrap_or_default(),
        &message.provider_thread_id.clone().unwrap_or_default(),
        message.link_id,
        message.db_id.unwrap(),
    )
    .await?;

    // set provider id of thread - needed in case it's a thread with no other messages, as it wouldn't
    // have a provider id yet
    email_db_client::threads::update::update_thread_provider_id(
        tx.as_mut(),
        thread_db_id,
        message.link_id,
        &message.provider_thread_id.clone().unwrap(),
    )
    .await?;

    email_db_client::threads::update::update_thread_metadata(
        tx.as_mut(),
        thread_db_id,
        message.link_id,
    )
    .await?;

    email_db_client::threads::update::sync_thread_calendar_flag(tx.as_mut(), thread_db_id).await?;

    Ok(())
}

#[cfg(test)]
mod test;

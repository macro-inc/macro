//! PostgreSQL and provider adapters for scheduled email delivery.
use crate::outbound::email_api::GmailApi;
use crate::util::gmail::send::{
    cleanup_draft_attachments, fetch_and_attach_draft_attachments,
    fetch_and_attach_forwarded_attachments, generate_email_threading_headers,
};
use anyhow::Context;
use chrono::Utc;
use email::domain::events::{EmailEventOrigin, EmailMacroEvent, MessageSentMetadata};
use email::domain::scheduled_delivery::{ScheduledDeliveryRepo, ScheduledMessageSender};
use email_api_client::domain::models::{SendRequest, SentIds};
use email_db_client::messages::scheduled::get::get_and_start_processing_scheduled_message;
use macro_event_broker::{KafkaEventPublisher, MacroEventBroker, MacroEventBrokerService};
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::{
    attachment::AttachmentDraft,
    link::Link,
    message::{MessageToSend, ScheduledMessage},
};
use tokio_util::task::TaskTracker;
use uuid::Uuid;

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
    schedule: ScheduledMessage,
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
    ) -> anyhow::Result<Option<ScheduledClaim>> {
        let Some(link) = email_db_client::links::get::fetch_link_by_id(&self.db, link_id).await?
        else {
            return Ok(None);
        };
        Ok(
            get_and_start_processing_scheduled_message(&self.db, link_id, message_id)
                .await?
                .map(|schedule| ScheduledClaim { link, schedule }),
        )
    }

    async fn release(&self, claim: ScheduledClaim) -> anyhow::Result<()> {
        email_db_client::messages::scheduled::upsert::clear_scheduled_message_processing(
            &self.db,
            claim.schedule.link_id,
            claim.schedule.message_id,
        )
        .await?;
        Ok(())
    }

    async fn complete(&self, claim: &ScheduledClaim, sent: SentDelivery) -> anyhow::Result<()> {
        let ctx = self;
        let link = &claim.link;
        let data = &claim.schedule;
        let scheduled_message = &claim.schedule;
        let message_to_send = sent.message;
        let db_attachments = sent.attachments;
        let mut tx = ctx
            .db
            .begin()
            .await
            .context("Failed to begin transaction")?;

        let result = process_sent_message(tx.as_mut(), &message_to_send).await;

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

impl ScheduledMessageSender<ScheduledClaim, SentDelivery> for ScheduledDeliveryAdapter {
    async fn send_claimed(&self, claim: &ScheduledClaim) -> anyhow::Result<SentDelivery> {
        let ctx = self;
        let link = &claim.link;
        let data = &claim.schedule;
        // fetch message from db
        let (mut message_to_send, sender_contact) =
            email_db_client::messages::get::get_message_to_send(
                &ctx.db,
                data.message_id,
                data.link_id,
            )
            .await
            .context(format!(
                "Failed to fetch message to gmail api for message_id {}",
                data.message_id
            ))?;

        // generate headers
        let (parent_message_id, references) =
            generate_email_threading_headers(&ctx.db, message_to_send.replying_to_id, data.link_id)
                .await;

        // Include draft attachments (user-uploaded files from S3)
        let db_attachments = fetch_and_attach_draft_attachments(
            &ctx.db,
            &ctx.s3_client,
            ctx.attachment_bucket.as_str(),
            link,
            &mut message_to_send,
        )
        .await?;

        // Include forwarded attachments (fetched from Gmail at send time)
        fetch_and_attach_forwarded_attachments(&ctx.db, &ctx.email_api, link, &mut message_to_send)
            .await?;

        let send_request = SendRequest {
            message: message_to_send.clone(),
            from: sender_contact,
            parent_message_id,
            references,
        };
        let sent_ids = ctx
            .email_api
            .send_message(
                link.id,
                &send_request,
                message_to_send.provider_thread_id.as_deref(),
            )
            .await
            .context(format!(
                "Failed to send message to gmail api for message_id {}",
                data.message_id
            ))?;
        apply_sent_ids(&mut message_to_send, sent_ids);

        Ok(SentDelivery {
            message: message_to_send,
            attachments: db_attachments,
        })
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
    message: &MessageToSend,
) -> anyhow::Result<()> {
    // mark message as non-draft
    email_db_client::messages::update::mark_message_as_sent(
        tx.as_mut(),
        &message.provider_id.clone().unwrap_or_default(),
        &message.provider_thread_id.clone().unwrap_or_default(),
        message.link_id,
        message.db_id.unwrap(),
    )
    .await?;

    // mark scheduled message as sent
    let finalized = email_db_client::messages::scheduled::upsert::mark_scheduled_message_as_sent(
        tx.as_mut(),
        message.link_id,
        message.db_id.unwrap(),
    )
    .await?;
    anyhow::ensure!(finalized, "scheduled delivery claim no longer exists");

    // safe as it was fetched from the database - message is only inserted once thread is created
    let thread_db_id = message.thread_db_id.unwrap();

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

    Ok(())
}

#[cfg(test)]
mod test;

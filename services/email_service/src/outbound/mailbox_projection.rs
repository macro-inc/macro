//! Adapters from durable email projections to existing Macro services.

use crate::outbound::inbox_source::inbox_provider;
use chrono::{DateTime, Utc};
use contacts::domain::{
    models::{list::InboxSource, messages::ContactConnection},
    ports::{ContactListIngress, ContactsIngress},
};
use email::domain::{
    events::EmailMacroEvent,
    invitation_extraction::InvitationExtractionRepository,
    mailbox::{
        DatabaseFailure, EffectFailure, MailboxError, MailboxKey, projection::*,
        telemetry::defer_reason,
    },
    models::calendar_invitation::CalendarInvitation,
};
use email_db_client::attachments::provider::upload::ClaimedAttachment;
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_notifications::NewEmailMetadata;
use models_email::{
    api::refresh::RefreshEmailEvent,
    service::{
        attachment::{AttachmentUploadArgs, AttachmentUploadDestination},
        backfill::{
            BackfillOperation, BackfillPubsubMessage, LinkScopedPayload, PopulateCrmContactPayload,
        },
    },
};
use notification::domain::{models::SendNotificationRequestBuilder, service::NotificationIngress};
use std::{collections::HashSet, sync::Arc};
use system_properties::{PgSystemPropertiesRepository, SystemPropertiesServiceImpl};
use uuid::Uuid;

#[cfg(test)]
mod test;

pub struct MailboxEffects<A, I, B, N, C> {
    pub db: sqlx::PgPool,
    pub attachments: A,
    pub invitations: I,
    pub broker: B,
    pub notification: Arc<N>,
    pub contacts: Arc<C>,
    pub queue: sqs_client::SQS,
    pub gateway: connection_gateway_client::client::ConnectionGatewayClient,
    pub dss: document_storage_service_client::DocumentStorageServiceClient,
    pub sfs: static_file_service_client::StaticFileServiceClient,
    pub properties: Arc<SystemPropertiesServiceImpl<PgSystemPropertiesRepository>>,
    pub notifications_enabled: bool,
}

/// A downstream effect (event broker, queue, another service) failed.
fn failed<E: std::fmt::Debug>(error: E) -> MailboxError {
    tracing::warn!(?error, "mailbox projection effect deferred");
    MailboxError::Effect(EffectFailure::Downstream)
}

/// A database step of an effect keeps its SQLSTATE, so it reports as
/// `persistence` (or `unstorable`, for a value the database refuses) rather
/// than as an effect failure.
fn database_failed(error: &dyn std::fmt::Debug, cause: Option<&sqlx::Error>) -> MailboxError {
    tracing::warn!(?error, "mailbox projection effect deferred");
    cause.map_or(MailboxError::Persistence, |cause| {
        MailboxError::database(DatabaseFailure::from(cause))
    })
}

/// Durable refreshes retry a refused gateway handoff. Delivery may repeat;
/// readers coalesce these idempotent invalidations and catch up on reconnect.
async fn refresh_email_durable(
    gateway: &connection_gateway_client::client::ConnectionGatewayClient,
    viewer: &str,
    event: RefreshEmailEvent,
) -> Result<(), MailboxError> {
    if cfg!(feature = "connection_gateway") {
        let payload = serde_json::to_value(event)
            .map_err(|_| MailboxError::Effect(EffectFailure::Downstream))?;
        gateway.refresh_email(viewer, payload).await.map_err(|_| {
            tracing::warn!("mailbox refresh gateway handoff failed");
            MailboxError::Effect(EffectFailure::Downstream)
        })?;
    }
    Ok(())
}

impl<A, I, B, N, C> MailboxProjectionEffects for MailboxEffects<A, I, B, N, C>
where
    A: MailboxAttachmentAccess,
    I: InvitationExtractionRepository + 'static,
    B: MacroEventBroker,
    N: NotificationIngress + 'static,
    C: ContactsIngress + ContactListIngress + 'static,
{
    async fn reauthorization(
        &self,
        id: Uuid,
        context: &ProjectionContext,
    ) -> Result<(), MailboxError> {
        let request = SendNotificationRequestBuilder {
            notification_entity: EntityType::User
                .with_entity_string(context.link.macro_id.to_string()),
            secondary_notification_entity: None,
            notification: model_notifications::InboxReauthRequiredMetadata {
                email_address: context.link.email_address.0.as_ref().into(),
            },
            sender_id: None,
            recipient_ids: context.viewers.clone(),
        }
        .into_request_with_id(id)
        .with_conn_gateway();
        self.notification
            .send_notification(request)
            .await
            .map_err(failed)?;
        Ok(())
    }
    async fn photo_refresh(
        &self,
        link_id: Uuid,
        viewers: &HashSet<MacroUserIdStr<'static>>,
    ) -> Result<(), MailboxError> {
        for viewer in viewers {
            crate::pubsub::util::cg_refresh_email(
                &self.gateway,
                viewer.as_ref(),
                RefreshEmailEvent::PhotoSynced { link_id },
            )
            .await;
        }
        Ok(())
    }
    async fn publish(&self, event: EmailMacroEvent) -> Result<(), MailboxError> {
        // Await the broker acknowledgement before deleting durable work.
        self.broker
            .send_event(&event)
            .map_err(failed)?
            .await
            .map_err(failed)?
            .map_err(failed)
    }
    async fn refresh(
        &self,
        link_id: Uuid,
        viewers: &HashSet<MacroUserIdStr<'static>>,
    ) -> Result<(), MailboxError> {
        for viewer in viewers {
            refresh_email_durable(
                &self.gateway,
                viewer.as_ref(),
                RefreshEmailEvent::UpsertMessage { link_id },
            )
            .await?;
        }
        Ok(())
    }
    async fn import_completed(
        &self,
        link_id: Uuid,
        viewers: &HashSet<MacroUserIdStr<'static>>,
    ) -> Result<(), MailboxError> {
        for viewer in viewers {
            refresh_email_durable(
                &self.gateway,
                viewer.as_ref(),
                RefreshEmailEvent::Backfill {
                    link_id,
                    status: models_email::api::refresh::BackfillStatus::Complete,
                },
            )
            .await?;
        }
        Ok(())
    }
    async fn notify(&self, notification: MailboxNotification) -> Result<(), MailboxError> {
        if !self.notifications_enabled {
            return Ok(());
        }
        let request = SendNotificationRequestBuilder {
            notification_entity: EntityType::EmailThread
                .with_entity_string(notification.thread_id.to_string()),
            secondary_notification_entity: None,
            notification: NewEmailMetadata {
                sender: notification.sender,
                to_email: notification.to_email,
                thread_id: notification.thread_id.to_string(),
                subject: notification.subject,
                snippet: notification.snippet,
            },
            sender_id: notification.sender_id,
            recipient_ids: notification.recipients,
        }
        .into_request_with_id(notification.id);
        let request = if notification.signal {
            request.with_conn_gateway()
        } else {
            request
        };
        if notification.push {
            self.notification
                .send_notification(request.with_apns())
                .await
                .map_err(failed)?;
        } else {
            self.notification
                .send_notification(request)
                .await
                .map_err(failed)?;
        }
        Ok(())
    }
    async fn contacts(&self, correspondence: CorrespondenceProjection) -> Result<(), MailboxError> {
        if cfg!(feature = "contacts_sync") && !correspondence.connections.is_empty() {
            let connections = correspondence
                .connections
                .iter()
                .map(|contact| {
                    ContactConnection::new(correspondence.owner.clone(), contact.clone())
                })
                .collect();
            self.contacts
                .enqueue_contact_connections(connections)
                .await
                .map_err(failed)?;
            let inbox = InboxSource {
                owner: correspondence.owner.clone(),
                link_id: correspondence.link_id,
                provider: inbox_provider(correspondence.provider),
            };
            self.contacts
                .record_inbox_contacts(inbox, correspondence.connections)
                .await
                .map_err(failed)?;
        }
        for contact in correspondence.contacts {
            self.queue
                .enqueue_email_backfill_message(BackfillPubsubMessage {
                    backfill_operation: BackfillOperation::PopulateCrmContact(LinkScopedPayload {
                        link_id: correspondence.link_id,
                        payload: PopulateCrmContactPayload {
                            live_mail: true,
                            contact_email: contact.email,
                            contact_name: contact.name,
                            first_at: contact.at,
                            last_at: contact.at,
                            is_sent: correspondence.is_sent,
                        },
                    }),
                })
                .await
                .map_err(failed)?;
        }
        Ok(())
    }
    async fn invitations(
        &self,
        message_id: Uuid,
        invitations: &[CalendarInvitation],
    ) -> Result<(), MailboxError> {
        self.invitations
            .save(message_id, invitations)
            .await
            .map_err(|report| database_failed(&report, report.downcast_current_context()))
    }
    async fn attachments(
        &self,
        mailbox: MailboxKey,
        context: &ProjectionContext,
        is_import: bool,
    ) -> Result<(), MailboxError> {
        if !cfg!(feature = "attachment_upload") {
            return Ok(());
        }
        let Some(current) = &context.message else {
            return Ok(());
        };
        let Some(provider_id) = &current.message.provider_id else {
            return Ok(());
        };
        // Claims left by a terminated worker become eligible again. Completed
        // DSS/SFS mappings are excluded by the owning attachment repository.
        sqlx::query!(
            r#"
            UPDATE email_attachments a SET upload_claimed_at = NULL FROM email_messages m
            WHERE a.message_id = m.id AND m.link_id = $1 AND m.id = $2
                AND a.upload_claimed_at < now() - interval '3 minutes'
                AND a.upload_abandoned_at IS NULL
                AND NOT EXISTS(SELECT 1 FROM document_email d WHERE d.email_attachment_id = a.id)
                AND NOT EXISTS(SELECT 1 FROM email_attachments_sfs s WHERE s.attachment_id = a.id)
        "#,
            mailbox.link_id,
            current.message.db_id
        )
        .execute(&self.db)
        .await
        .map_err(|error| database_failed(&error, Some(&error)))?;
        let documents = email_db_client::attachments::provider::upload::new_email_document_atts(
            &self.db,
            mailbox.link_id,
            provider_id,
        )
        .await
        .map_err(|error| {
            database_failed(&error, error.chain().find_map(|cause| cause.downcast_ref()))
        })?;
        let media = email_db_client::attachments::provider::upload::new_email_media_atts(
            &self.db,
            mailbox.link_id,
            provider_id,
        )
        .await
        .map_err(|error| {
            database_failed(&error, error.chain().find_map(|cause| cause.downcast_ref()))
        })?;
        for (claimed, destination) in documents
            .into_iter()
            .map(|a| (a, AttachmentUploadDestination::Dss))
            .chain(
                media
                    .into_iter()
                    .map(|a| (a, AttachmentUploadDestination::Sfs)),
            )
        {
            let ClaimedAttachment {
                metadata: attachment,
                claimed_at,
            } = claimed;
            let attachment_id = attachment.attachment_db_id;
            let result = async {
                let data = self
                    .attachments
                    .download(
                        context.link.provider,
                        mailbox,
                        &attachment.email_provider_id,
                        &attachment.provider_attachment_id,
                    )
                    .await?;
                let args = AttachmentUploadArgs {
                    recipient_emails: current
                        .message
                        .to
                        .iter()
                        .map(|contact| contact.email.clone())
                        .collect(),
                    attachment_metadata: attachment,
                    backfill: is_import,
                    upload_destination: destination,
                };
                let stored = crate::util::upload_attachment::store_attachment(
                    crate::util::upload_attachment::AttachmentStorageContext {
                        db: &self.db,
                        dss_client: &self.dss,
                        sfs_client: &self.sfs,
                        system_properties_service: &self.properties,
                        link: &context.link,
                    },
                    &args,
                    data,
                )
                .await;
                // The deleted row took its claim with it; nothing is pending.
                if let Err(
                    crate::util::upload_attachment::UploadAttachmentError::AttachmentDeleted,
                ) = stored
                {
                    return Ok(());
                }
                stored.map_err(|error| match &error {
                    // Keeps the SQLSTATE, so a lock timeout is not counted
                    // against the attachment.
                    crate::util::upload_attachment::UploadAttachmentError::DatabaseError(cause) => {
                        database_failed(
                            &error,
                            cause.chain().find_map(|cause| cause.downcast_ref()),
                        )
                    }
                    _ => {
                        tracing::warn!(?error, "mailbox projection effect deferred");
                        MailboxError::Effect(EffectFailure::AttachmentUpload { attachment_id })
                    }
                })?;
                Ok::<_, MailboxError>(())
            }
            .await;
            if let Err(error) = result {
                let settled = self
                    .settle_failed_attachment(mailbox.link_id, attachment_id, claimed_at, &error)
                    .await;
                let error = match settled {
                    Ok(true) => continue,
                    Ok(false) => error,
                    // Recording the failure failed; that error is the step's now.
                    Err(settle_error) => settle_error,
                };
                // The projection names the attachment of an upload effect
                // itself (`EffectFailure::AttachmentUpload`); a download or
                // database failure carries none, so it is named here, once.
                if !matches!(error, MailboxError::Effect(_)) {
                    tracing::Span::current().record(
                        "outlook.attachment_id",
                        tracing::field::display(attachment_id),
                    );
                }
                return Err(error);
            }
        }
        let pending = email_db_client::attachments::provider::upload::oldest_pending_upload_claim(
            &self.db,
            current.message.db_id,
        )
        .await
        .map_err(|error| {
            database_failed(&error, error.chain().find_map(|cause| cause.downcast_ref()))
        })?;
        if let Some(claim) = pending {
            return Err(MailboxError::Effect(
                EffectFailure::AttachmentUploadPending {
                    attachment_id: claim.attachment_id,
                    claim_age_seconds: claim.claim_age_seconds,
                },
            ));
        }
        Ok(())
    }
}

impl<A, I, B, N, C> MailboxEffects<A, I, B, N, C> {
    /// Releases a failed attachment's claim for the event's next try, counting
    /// the failure against it unless `attachment_failure_limit` says it isn't
    /// counted. At the limit the attachment keeps its claim and is marked
    /// abandoned instead, so no claim takes it again and the projection stops
    /// waiting on it. Each write applies only while the claim is still the one
    /// this pass's claiming query set at `claimed_at`: a pass that lost it may
    /// find the attachment stored, or abandoned, by the pass that took it next.
    /// Returns whether it was abandoned.
    async fn settle_failed_attachment(
        &self,
        link_id: Uuid,
        attachment_id: Uuid,
        claimed_at: DateTime<Utc>,
        error: &MailboxError,
    ) -> Result<bool, MailboxError> {
        let Some(limit) = attachment_failure_limit(error) else {
            sqlx::query!(
                "UPDATE email_attachments SET upload_claimed_at = NULL
                WHERE id = $1 AND upload_claimed_at = $2",
                attachment_id,
                claimed_at
            )
            .execute(&self.db)
            .await
            .map_err(|error| database_failed(&error, Some(&error)))?;
            return Ok(false);
        };

        let settled = sqlx::query!(
            r#"
            UPDATE email_attachments SET
                upload_failures = upload_failures + 1,
                upload_claimed_at = CASE WHEN upload_failures + 1 >= $3 THEN upload_claimed_at END,
                upload_abandoned_at = CASE WHEN upload_failures + 1 >= $3 THEN now() END
            WHERE id = $1 AND upload_claimed_at = $2
            RETURNING upload_failures, upload_abandoned_at IS NOT NULL AS "abandoned!"
        "#,
            attachment_id,
            claimed_at,
            i32::from(limit)
        )
        .fetch_optional(&self.db)
        .await
        .map_err(|error| database_failed(&error, Some(&error)))?;
        let Some(settled) = settled else {
            return Ok(false);
        };

        if settled.abandoned {
            tracing::warn!(
                %link_id,
                %attachment_id,
                failures = settled.upload_failures,
                defer_reason = defer_reason(error),
                %error,
                "outlook attachment abandoned"
            );
        }
        Ok(settled.abandoned)
    }
}

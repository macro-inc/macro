//! Adapters from durable email projections to existing Macro services.

use contacts::domain::{models::messages::ContactConnection, ports::ContactsIngress};
use email::domain::{
    events::EmailMacroEvent,
    invitation_extraction::InvitationExtractionRepository,
    mailbox::{MailboxError, MailboxKey, projection::*},
    models::calendar_invitation::CalendarInvitation,
};
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

fn failed<E: std::fmt::Debug>(error: E) -> MailboxError {
    tracing::warn!(?error, "mailbox projection effect deferred");
    MailboxError::Persistence
}

impl<A, I, B, N, C> MailboxProjectionEffects for MailboxEffects<A, I, B, N, C>
where
    A: MailboxAttachmentAccess,
    I: InvitationExtractionRepository + 'static,
    B: MacroEventBroker,
    N: NotificationIngress + 'static,
    C: ContactsIngress + 'static,
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
            crate::pubsub::util::cg_refresh_email(
                &self.gateway,
                viewer.as_ref(),
                RefreshEmailEvent::UpsertMessage { link_id },
            )
            .await;
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
                .into_iter()
                .map(|contact| ContactConnection::new(correspondence.owner.clone(), contact))
                .collect();
            self.contacts
                .enqueue_contact_connections(connections)
                .await
                .map_err(failed)?;
        }
        for contact in correspondence.contacts {
            self.queue
                .enqueue_email_backfill_message(BackfillPubsubMessage {
                    backfill_operation: BackfillOperation::PopulateCrmContact(LinkScopedPayload {
                        link_id: correspondence.link_id,
                        payload: PopulateCrmContactPayload {
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
            .map_err(failed)
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
                AND NOT EXISTS(SELECT 1 FROM document_email d WHERE d.email_attachment_id = a.id)
                AND NOT EXISTS(SELECT 1 FROM email_attachments_sfs s WHERE s.attachment_id = a.id)
        "#,
            mailbox.link_id,
            current.message.db_id
        )
        .execute(&self.db)
        .await
        .map_err(failed)?;
        let documents = email_db_client::attachments::provider::upload::new_email_document_atts(
            &self.db,
            mailbox.link_id,
            provider_id,
        )
        .await
        .map_err(failed)?;
        let media = email_db_client::attachments::provider::upload::new_email_media_atts(
            &self.db,
            mailbox.link_id,
            provider_id,
        )
        .await
        .map_err(failed)?;
        for (attachment, destination) in documents
            .into_iter()
            .map(|a| (a, AttachmentUploadDestination::Dss))
            .chain(
                media
                    .into_iter()
                    .map(|a| (a, AttachmentUploadDestination::Sfs)),
            )
        {
            let attachment_id = attachment.attachment_db_id;
            let result = async {
                let data = self
                    .attachments
                    .download(
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
                crate::util::upload_attachment::store_attachment(
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
                .await
                .map_err(failed)?;
                Ok::<_, MailboxError>(())
            }
            .await;
            if result.is_err() {
                sqlx::query!(
                    "UPDATE email_attachments SET upload_claimed_at = NULL WHERE id = $1",
                    attachment_id
                )
                .execute(&self.db)
                .await
                .map_err(failed)?;
                return result;
            }
        }
        let pending = sqlx::query_scalar!(r#"
            SELECT EXISTS(SELECT 1 FROM email_attachments a WHERE a.message_id = $1
                AND a.upload_claimed_at IS NOT NULL
                AND NOT EXISTS(SELECT 1 FROM document_email d WHERE d.email_attachment_id = a.id)
                AND NOT EXISTS(SELECT 1 FROM email_attachments_sfs s WHERE s.attachment_id = a.id)) AS "pending!"
        "#,current.message.db_id).fetch_one(&self.db).await.map_err(failed)?;
        if pending {
            return Err(MailboxError::Persistence);
        }
        Ok(())
    }
}

use email::domain::mailbox::{MailboxError, lifecycle::*};
use models_email::{
    api::refresh::RefreshEmailEvent,
    service::{
        backfill::{BackfillOperation, BackfillPubsubMessage, InitPayload, JobScopedPayload},
        pubsub::LinkManagerMessage,
    },
};
use uuid::Uuid;

pub(crate) mod inbox_sync;

use email_api_client::domain::models::{AccessToken, EmailApiError, MailboxAccess, ProviderId};
use email_api_client::domain::ports::{MailboxWatchClient, ScopedMailboxRepository};

pub struct InboxLifecycleClients {
    pub outlook: email_api_client::OutlookApiClientRepository,
    pub auth: authentication_service_client::AuthServiceClient,
    pub queue: sqs_client::SQS,
    pub gateway: connection_gateway_client::client::ConnectionGatewayClient,
}
impl InboxLifecycleEffects for InboxLifecycleClients {
    async fn apply(&self, link: Uuid, effect: &InboxLifecycleEffect) -> Result<(), MailboxError> {
        match effect {
            InboxLifecycleEffect::GmailHistory { work } => {
                use email::domain::mailbox::gmail_history::HistoryWork;
                use models_email::gmail::inbox_sync::{
                    DeleteMessagePayload, InboxSyncOperation, InboxSyncPubsubMessage,
                    UpdateLabelsPayload, UpsertMessagePayload,
                };
                let operation = match work {
                    HistoryWork::Upsert { provider_id } => {
                        InboxSyncOperation::UpsertMessage(UpsertMessagePayload {
                            provider_message_id: provider_id.clone(),
                        })
                    }
                    HistoryWork::Delete { provider_id } => {
                        InboxSyncOperation::DeleteMessage(DeleteMessagePayload {
                            provider_message_id: provider_id.clone(),
                        })
                    }
                    HistoryWork::Labels { provider_id } => {
                        InboxSyncOperation::UpdateLabels(UpdateLabelsPayload {
                            provider_message_id: provider_id.clone(),
                        })
                    }
                };
                self.queue
                    .enqueue_gmail_inbox_sync_notification(InboxSyncPubsubMessage {
                        link_id: link,
                        operation,
                    })
                    .await
                    .map_err(|_| MailboxError::Persistence)
            }

            InboxLifecycleEffect::CleanupMicrosoftWatches {
                grant_generation,
                sync_generation,
                attempt_ids,
                provider_ids,
            } => {
                let token = match self
                    .auth
                    .get_microsoft_disconnect_token(link, *grant_generation, *sync_generation)
                    .await
                {
                    Ok(token) => AccessToken::new(token.access_token),
                    Err(
                        authentication_service_client::error::AuthServiceClientError::Unauthorized
                        | authentication_service_client::error::AuthServiceClientError::Forbidden
                        | authentication_service_client::error::AuthServiceClientError::NotFound,
                    ) => return Ok(()),
                    Err(_) => return Err(MailboxError::Persistence),
                };
                let provider = self.outlook.for_mailbox(MailboxAccess {
                    link_id: link,
                    grant_generation: *grant_generation,
                    sync_generation: *sync_generation,
                });
                let watches = match provider.watches(&token).await {
                    Ok(watches) => watches,
                    Err(EmailApiError::AuthRequired | EmailApiError::Forbidden) => {
                        return Ok(());
                    }
                    Err(error) => return Err(error.into()),
                };
                for watch in watches {
                    let attempt = url::Url::parse(&watch.notification_url)
                        .ok()
                        .and_then(|url| {
                            let path = url.path();
                            path.strip_prefix("/outlook/webhook/")
                                .or_else(|| path.rsplit_once("/outlook/webhook/").map(|(_, id)| id))
                                .and_then(|id| Uuid::parse_str(id).ok())
                        });
                    if provider_ids
                        .iter()
                        .any(|id| id == watch.subscription.id.as_str())
                        || attempt.is_some_and(|id| attempt_ids.contains(&id))
                    {
                        match provider.remove_watch(&token, &watch.subscription.id).await {
                            Ok(())
                            | Err(EmailApiError::AuthRequired | EmailApiError::Forbidden) => {}
                            Err(error) => return Err(error.into()),
                        }
                    }
                }
                // DELETE is idempotent, including subscriptions omitted by a paged listing.
                for id in provider_ids {
                    match provider
                        .remove_watch(&token, &ProviderId::new(id.clone())?)
                        .await
                    {
                        Ok(()) | Err(EmailApiError::AuthRequired | EmailApiError::Forbidden) => {}
                        Err(error) => return Err(error.into()),
                    }
                }
                Ok(())
            }
            InboxLifecycleEffect::RevokeMicrosoftGrant {
                grant_id,
                generation,
                owner,
            } => self
                .auth
                .revoke_microsoft_grant(*grant_id, *generation, owner)
                .await
                .map_err(|_| MailboxError::Persistence),
            InboxLifecycleEffect::DeleteMailbox { reason } => self
                .queue
                .enqueue_link_manager_notification(LinkManagerMessage::DeleteLink {
                    link_id: link,
                    deletion_reason: *reason,
                })
                .await
                .map_err(|_| MailboxError::Persistence),
            InboxLifecycleEffect::GmailBackfill { job_id } => self
                .queue
                .enqueue_email_backfill_message(BackfillPubsubMessage {
                    backfill_operation: BackfillOperation::Init(JobScopedPayload {
                        link_id: link,
                        job_id: *job_id,
                        payload: InitPayload {},
                    }),
                })
                .await
                .map_err(|_| MailboxError::Persistence),
            InboxLifecycleEffect::AccessRemoved { viewer } => {
                if cfg!(feature = "connection_gateway") {
                    let payload =
                        serde_json::to_value(RefreshEmailEvent::LinkRemoved { link_id: link })
                            .map_err(|_| MailboxError::Persistence)?;
                    self.gateway
                        .refresh_email(viewer, payload)
                        .await
                        .map_err(|_| MailboxError::Persistence)?;
                }
                Ok(())
            }
        }
    }
}

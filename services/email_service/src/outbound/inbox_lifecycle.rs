use email::domain::mailbox::{MailboxError, lifecycle::*};
use models_email::{
    api::refresh::RefreshEmailEvent,
    service::{
        backfill::{BackfillOperation, BackfillPubsubMessage, InitPayload, JobScopedPayload},
        pubsub::LinkManagerMessage,
    },
};
use uuid::Uuid;

use email_api_client::domain::models::{AccessToken, MailboxAccess, ProviderId};
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

use crate::outbound::email_api::GmailApi;
use email_api_client::domain::models::EmailApiError;
use models_email::service::{
    cache::TokenCacheKey,
    link::{Link, UserProvider},
};
use std::{future::Future, time::Duration};
/// Backoff schedule for teardown provider calls: three attempts total.
const TEARDOWN_RETRY_DELAYS: [Duration; 2] =
    [Duration::from_millis(200), Duration::from_millis(400)];

/// Runs a teardown provider call with a bounded retry (3 attempts, 200/400ms).
///
/// Only transient failures retry. Permanent errors (revoked grants, missing
/// scopes) return immediately: retrying cannot help while tearing a link down.
pub(crate) async fn retry_teardown<F, Fut>(mut operation: F) -> Result<(), EmailApiError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<(), EmailApiError>>,
{
    let mut delays = TEARDOWN_RETRY_DELAYS.iter();
    loop {
        match operation().await {
            Ok(()) => return Ok(()),
            Err(error) if error.is_transient() => match delays.next() {
                Some(delay) => tokio::time::sleep(*delay).await,
                None => return Err(error),
            },
            Err(error) => return Err(error),
        }
    }
}

pub async fn remove_provider_link(
    gmail: &GmailApi,
    auth: &authentication_service_client::AuthServiceClient,
    redis: &crate::util::redis::RedisClient,
    link: &Link,
) {
    // Microsoft grants are revoked by the lifecycle outbox after the binding
    // is frozen. Gmail owns an independent FusionAuth grant and watch.
    if link.provider != UserProvider::Gmail {
        return;
    }
    // Best effort: revoked grants and provider failures must not block local teardown.
    // Stop before evicting the token so a valid cached grant remains available for the call.
    // The health-neutral path never marks the link as needing reauth or notifies the
    // user about an inbox that is being intentionally removed.
    retry_teardown(|| gmail.stop_subscription_for_link(link))
        .await
        .inspect_err(|error| {
            tracing::warn!(error=?error, "Gmail call to stop watch failed");
        })
        .ok();

    // delete cached access token, in case user re-enables within cache window
    redis
        .delete_gmail_access_token(&TokenCacheKey::new(
            link.fusionauth_user_id.clone(),
            link.email_address.0.as_ref(),
            UserProvider::Gmail.as_str(),
        ))
        .await
        .inspect_err(|e| {
            tracing::warn!(error=?e, "Failed to delete Gmail access token");
        })
        .ok();

    // remove google fusionauth link with gmail inbox permissions. best-effort: the FA user may
    // already be gone (e.g. account deleted before we delete their email), so we warn and keep
    // going rather than failing the message and retrying.
    auth.remove_link(
        &link.fusionauth_user_id,
        link.email_address.0.as_ref(),
        "google_gmail",
    )
    .await
    .inspect_err(|e| {
        tracing::warn!(error=?e, "Failed to remove FusionAuth IdP link");
    })
    .ok();
}

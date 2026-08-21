//! Capability-oriented ports for provider email APIs.

use std::future::Future;

use models_email::email::service::label::Label;
use models_email::email::service::message::Message;
use models_email::service::contact::{Contact, ContactList};
use models_email::service::link::Link;
use uuid::Uuid;

use super::models::{
    AccessToken, ApiOperationKind, CalendarPart, ChangeBatch, EmailApiError,
    MessageWithCalendarParts, ProviderSubscription, RateLimitRefusal, SendRequest, SentIds,
    SyncCursor, ThreadListPage, TokenError, TokenFreshness,
};

#[cfg(test)]
mod test;

/// Incremental synchronization and mailbox discovery capabilities.
pub trait MailboxSyncClient: Send + Sync + 'static {
    /// Returns the number of threads currently reported by the mailbox.
    fn get_thread_count(
        &self,
        access_token: &AccessToken,
    ) -> impl Future<Output = Result<u64, EmailApiError>> + Send;

    /// Returns mailbox changes that follow `cursor`.
    fn list_changes(
        &self,
        access_token: &AccessToken,
        cursor: &SyncCursor,
    ) -> impl Future<Output = Result<ChangeBatch, EmailApiError>> + Send;
}

/// Mailbox push-notification subscription capabilities.
pub trait MailboxSubscriptionClient: Send + Sync + 'static {
    /// Creates or renews the provider notification subscription.
    fn subscribe(
        &self,
        access_token: &AccessToken,
    ) -> impl Future<Output = Result<ProviderSubscription, EmailApiError>> + Send;

    /// Stops provider notifications for the mailbox.
    fn unsubscribe(
        &self,
        access_token: &AccessToken,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
}

/// Message and thread read/write capabilities, excluding message sending.
pub trait MailboxMessageClient: Send + Sync + 'static {
    /// Fetches and normalizes one provider message, surfacing any calendar
    /// invitation parts found in the same wire fetch.
    fn get_message(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        provider_message_id: &str,
    ) -> impl Future<Output = Result<Option<MessageWithCalendarParts>, EmailApiError>> + Send;

    /// Fetches the provider label identifiers currently attached to a message.
    fn get_message_label_ids(
        &self,
        access_token: &AccessToken,
        provider_message_id: &str,
    ) -> impl Future<Output = Result<Option<Vec<String>>, EmailApiError>> + Send;

    /// Lists message identifiers carrying all requested provider labels.
    fn list_messages(
        &self,
        access_token: &AccessToken,
        limit: u32,
        label_ids: &[&str],
    ) -> impl Future<Output = Result<Vec<String>, EmailApiError>> + Send;

    /// Lists the message identifiers belonging to a provider thread.
    fn get_message_ids_for_thread(
        &self,
        access_token: &AccessToken,
        provider_thread_id: &str,
    ) -> impl Future<Output = Result<Vec<String>, EmailApiError>> + Send;

    /// Fetches and normalizes every message in a provider thread.
    fn get_thread(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        provider_thread_id: &str,
    ) -> impl Future<Output = Result<Vec<Message>, EmailApiError>> + Send;

    /// Lists one page of provider threads.
    fn list_threads(
        &self,
        access_token: &AccessToken,
        limit: u32,
        next_page_token: Option<&str>,
        label_ids: &[&str],
    ) -> impl Future<Output = Result<ThreadListPage, EmailApiError>> + Send;

    /// Adds and removes provider labels from one message.
    fn modify_message_labels(
        &self,
        access_token: &AccessToken,
        provider_message_id: &str,
        label_ids_to_add: &[String],
        label_ids_to_remove: &[String],
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
}

/// Message sending capability.
pub trait MailboxSendClient: Send + Sync + 'static {
    /// Builds and sends a message, optionally in an existing provider thread.
    fn send_message(
        &self,
        access_token: &AccessToken,
        request: &SendRequest,
        provider_thread_id: Option<&str>,
    ) -> impl Future<Output = Result<SentIds, EmailApiError>> + Send;
}

/// Mailbox label management capabilities.
pub trait MailboxLabelClient: Send + Sync + 'static {
    /// Lists and normalizes all mailbox labels.
    fn list_labels(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
    ) -> impl Future<Output = Result<Vec<Label>, EmailApiError>> + Send;

    /// Creates and normalizes a user label.
    fn create_label(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        name: &str,
    ) -> impl Future<Output = Result<Label, EmailApiError>> + Send;

    /// Deletes a provider label.
    fn delete_label(
        &self,
        access_token: &AccessToken,
        provider_label_id: &str,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
}

/// Calendar invitation discovery capability.
///
/// This id-based lookup issues a fresh provider fetch (and pays its quota
/// charge). Ingest paths that already hold the fetched message should use the
/// calendar parts surfaced by [`MailboxMessageClient::get_message`] instead;
/// this port exists for durable re-extraction jobs where a fresh fetch is
/// correct.
pub trait MailboxCalendarClient: Send + Sync + 'static {
    /// Finds provider-neutral calendar parts in one message.
    fn get_calendar_parts(
        &self,
        access_token: &AccessToken,
        provider_message_id: &str,
    ) -> impl Future<Output = Result<Vec<CalendarPart>, EmailApiError>> + Send;
}

/// Message attachment download capability.
pub trait MailboxAttachmentClient: Send + Sync + 'static {
    /// Downloads the decoded bytes of a provider attachment.
    fn get_attachment(
        &self,
        access_token: &AccessToken,
        provider_message_id: &str,
        provider_attachment_id: &str,
    ) -> impl Future<Output = Result<Vec<u8>, EmailApiError>> + Send;
}

/// Mailbox contact synchronization capabilities.
pub trait MailboxContactsClient: Send + Sync + 'static {
    /// Fetches and normalizes the mailbox owner's contact record.
    fn get_self_contact(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
    ) -> impl Future<Output = Result<Contact, EmailApiError>> + Send;

    /// Fetches and normalizes primary contacts from an optional synchronization token.
    fn list_contacts(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        sync_token: Option<&str>,
    ) -> impl Future<Output = Result<ContactList, EmailApiError>> + Send;

    /// Fetches and normalizes automatically collected contacts.
    fn list_other_contacts(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        sync_token: Option<&str>,
    ) -> impl Future<Output = Result<ContactList, EmailApiError>> + Send;
}

/// Blocked-sender management capabilities.
pub trait MailboxBlocklistClient: Send + Sync + 'static {
    /// Ensures messages from `email_address` are sent to trash.
    fn block_sender(
        &self,
        access_token: &AccessToken,
        email_address: &str,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;

    /// Removes the blocked-sender rule for `email_address`, when present.
    fn unblock_sender(
        &self,
        access_token: &AccessToken,
        email_address: &str,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;

    /// Lists email addresses covered by blocked-sender rules.
    fn list_blocked_senders(
        &self,
        access_token: &AccessToken,
    ) -> impl Future<Output = Result<Vec<String>, EmailApiError>> + Send;
}

/// Provider repository assembled from the eight core mailbox capabilities.
///
/// [`MailboxCalendarClient`] is deliberately not part of this bound: calendar
/// part discovery is optional and composed separately where needed.
pub trait EmailApiClientRepository:
    MailboxSyncClient
    + MailboxSubscriptionClient
    + MailboxMessageClient
    + MailboxSendClient
    + MailboxLabelClient
    + MailboxAttachmentClient
    + MailboxContactsClient
    + MailboxBlocklistClient
{
}

impl<T> EmailApiClientRepository for T where
    T: MailboxSyncClient
        + MailboxSubscriptionClient
        + MailboxMessageClient
        + MailboxSendClient
        + MailboxLabelClient
        + MailboxAttachmentClient
        + MailboxContactsClient
        + MailboxBlocklistClient
{
}

/// Acquires provider access tokens for a linked mailbox.
pub trait ProviderTokenSource: Send + Sync + 'static {
    /// Returns an access token with the requested freshness.
    fn get_access_token(
        &self,
        link_id: Uuid,
        freshness: TokenFreshness,
    ) -> impl Future<Output = Result<AccessToken, TokenError>> + Send;

    /// Returns an access token for a link that may not have been persisted yet.
    ///
    /// Required (no default): a default delegating to the id-based lookup
    /// would contradict this method's purpose — the link's row may not exist
    /// yet — and an implementor silently relying on it would break mailbox
    /// initialization.
    fn get_access_token_for_link(
        &self,
        link: &Link,
        freshness: TokenFreshness,
    ) -> impl Future<Output = Result<AccessToken, TokenError>> + Send;

    /// Returns an access token without recording token-health side effects.
    ///
    /// Teardown flows use this: a failed acquisition while deleting a link
    /// must not mark the link as needing reauthorization or notify the user
    /// about an inbox that is being intentionally removed.
    fn get_access_token_health_neutral(
        &self,
        link: &Link,
        freshness: TokenFreshness,
    ) -> impl Future<Output = Result<AccessToken, TokenError>> + Send;
}

/// Applies provider quota policy before an outbound request.
pub trait ProviderRateLimiter: Send + Sync + 'static {
    /// Allows or refuses an operation for a linked mailbox.
    fn check_rate_limit(
        &self,
        link_id: Uuid,
        operation: ApiOperationKind,
    ) -> impl Future<Output = Result<(), RateLimitRefusal>> + Send;
}

/// Mailbox adapter used when provider capabilities are intentionally unavailable.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoOpMailboxClient;

/// Token source used when provider token acquisition is intentionally unavailable.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoOpProviderTokenSource;

/// Rate limiter that permits every operation.
#[derive(Debug, Clone, Copy, Default)]
pub struct AlwaysAllowRateLimiter;

fn unavailable() -> EmailApiError {
    EmailApiError::Permanent {
        message: "email provider capability is not configured".to_string(),
    }
}

impl MailboxSyncClient for NoOpMailboxClient {
    async fn get_thread_count(&self, _: &AccessToken) -> Result<u64, EmailApiError> {
        Err(unavailable())
    }

    async fn list_changes(
        &self,
        _: &AccessToken,
        _: &SyncCursor,
    ) -> Result<ChangeBatch, EmailApiError> {
        Err(unavailable())
    }
}

impl MailboxSubscriptionClient for NoOpMailboxClient {
    async fn subscribe(&self, _: &AccessToken) -> Result<ProviderSubscription, EmailApiError> {
        Err(unavailable())
    }

    async fn unsubscribe(&self, _: &AccessToken) -> Result<(), EmailApiError> {
        Err(unavailable())
    }
}

impl MailboxMessageClient for NoOpMailboxClient {
    async fn get_message(
        &self,
        _: &AccessToken,
        _: Uuid,
        _: &str,
    ) -> Result<Option<MessageWithCalendarParts>, EmailApiError> {
        Err(unavailable())
    }

    async fn get_message_label_ids(
        &self,
        _: &AccessToken,
        _: &str,
    ) -> Result<Option<Vec<String>>, EmailApiError> {
        Err(unavailable())
    }

    async fn list_messages(
        &self,
        _: &AccessToken,
        _: u32,
        _: &[&str],
    ) -> Result<Vec<String>, EmailApiError> {
        Err(unavailable())
    }

    async fn get_message_ids_for_thread(
        &self,
        _: &AccessToken,
        _: &str,
    ) -> Result<Vec<String>, EmailApiError> {
        Err(unavailable())
    }

    async fn get_thread(
        &self,
        _: &AccessToken,
        _: Uuid,
        _: &str,
    ) -> Result<Vec<Message>, EmailApiError> {
        Err(unavailable())
    }

    async fn list_threads(
        &self,
        _: &AccessToken,
        _: u32,
        _: Option<&str>,
        _: &[&str],
    ) -> Result<ThreadListPage, EmailApiError> {
        Err(unavailable())
    }

    async fn modify_message_labels(
        &self,
        _: &AccessToken,
        _: &str,
        _: &[String],
        _: &[String],
    ) -> Result<(), EmailApiError> {
        Err(unavailable())
    }
}

impl MailboxSendClient for NoOpMailboxClient {
    async fn send_message(
        &self,
        _: &AccessToken,
        _: &SendRequest,
        _: Option<&str>,
    ) -> Result<SentIds, EmailApiError> {
        Err(unavailable())
    }
}

impl MailboxLabelClient for NoOpMailboxClient {
    async fn list_labels(&self, _: &AccessToken, _: Uuid) -> Result<Vec<Label>, EmailApiError> {
        Err(unavailable())
    }

    async fn create_label(
        &self,
        _: &AccessToken,
        _: Uuid,
        _: &str,
    ) -> Result<Label, EmailApiError> {
        Err(unavailable())
    }

    async fn delete_label(&self, _: &AccessToken, _: &str) -> Result<(), EmailApiError> {
        Err(unavailable())
    }
}

impl MailboxAttachmentClient for NoOpMailboxClient {
    async fn get_attachment(
        &self,
        _: &AccessToken,
        _: &str,
        _: &str,
    ) -> Result<Vec<u8>, EmailApiError> {
        Err(unavailable())
    }
}

impl MailboxContactsClient for NoOpMailboxClient {
    async fn get_self_contact(&self, _: &AccessToken, _: Uuid) -> Result<Contact, EmailApiError> {
        Err(unavailable())
    }

    async fn list_contacts(
        &self,
        _: &AccessToken,
        _: Uuid,
        _: Option<&str>,
    ) -> Result<ContactList, EmailApiError> {
        Err(unavailable())
    }

    async fn list_other_contacts(
        &self,
        _: &AccessToken,
        _: Uuid,
        _: Option<&str>,
    ) -> Result<ContactList, EmailApiError> {
        Err(unavailable())
    }
}

impl MailboxBlocklistClient for NoOpMailboxClient {
    async fn block_sender(&self, _: &AccessToken, _: &str) -> Result<(), EmailApiError> {
        Err(unavailable())
    }

    async fn unblock_sender(&self, _: &AccessToken, _: &str) -> Result<(), EmailApiError> {
        Err(unavailable())
    }

    async fn list_blocked_senders(&self, _: &AccessToken) -> Result<Vec<String>, EmailApiError> {
        Err(unavailable())
    }
}

impl ProviderTokenSource for NoOpProviderTokenSource {
    async fn get_access_token(
        &self,
        _: Uuid,
        _: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        Err(TokenError::Permanent {
            message: "email provider token source is not configured".to_string(),
        })
    }

    async fn get_access_token_for_link(
        &self,
        _: &Link,
        _: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        Err(TokenError::Permanent {
            message: "email provider token source is not configured".to_string(),
        })
    }

    async fn get_access_token_health_neutral(
        &self,
        _: &Link,
        _: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        Err(TokenError::Permanent {
            message: "email provider token source is not configured".to_string(),
        })
    }
}

impl ProviderRateLimiter for AlwaysAllowRateLimiter {
    async fn check_rate_limit(&self, _: Uuid, _: ApiOperationKind) -> Result<(), RateLimitRefusal> {
        Ok(())
    }
}

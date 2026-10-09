//! Stream-oriented capabilities which do not assume native provider threads.

use std::future::Future;

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::domain::models::{
    AccessToken, EmailApiError, MailFolder, MailboxAccess, MailboxChangePage, MailboxMessage,
    MailboxSubscription, MessageAction, MessageWriteReceipt, ProviderId, StreamToken,
    SubmissionOutcome,
};

/// Personal contacts use independent cursors and permissions from mail.
pub trait MailboxAddressBookReader: Send + Sync + 'static {
    /// Discover all personal contact folders, including the default folder.
    fn contact_folders(
        &self,
        token: &AccessToken,
    ) -> impl Future<Output = Result<crate::domain::models::ContactFolderCatalog, EmailApiError>> + Send;
    /// Read one delta page without advancing the caller's durable checkpoint.
    fn contact_changes(
        &self,
        token: &AccessToken,
        folder: &ProviderId,
        position: Option<&StreamToken>,
    ) -> impl Future<Output = Result<crate::domain::models::AddressBookPage, EmailApiError>> + Send;
    /// Read the mailbox owner's profile, independent of contact consent.
    fn self_contact(
        &self,
        token: &AccessToken,
    ) -> impl Future<Output = Result<crate::domain::models::AddressBookContact, EmailApiError>> + Send;
    /// None identifies the mailbox owner's profile photo.
    fn contact_photo(
        &self,
        token: &AccessToken,
        contact: Option<(&ProviderId, &ProviderId)>,
    ) -> impl Future<Output = Result<Option<crate::domain::models::ContactPhoto>, EmailApiError>> + Send;
}

/// Credentials for an exact mailbox binding, including its reconnect generation.
pub trait MailboxTokenSource: Send + Sync + 'static {
    /// The credential owner validates the stored binding on every acquisition.
    fn access_token(
        &self,
        mailbox: crate::domain::models::MailboxAccess,
        freshness: crate::domain::models::TokenFreshness,
    ) -> impl Future<Output = Result<AccessToken, crate::domain::models::TokenError>> + Send;
}

/// Read normalized mailbox content independently of provider pagination.
pub trait MailboxContentReader: Send + Sync + 'static {
    /// Fetch only organization metadata for read-before-write reconciliation.
    fn organization(
        &self,
        token: &AccessToken,
        link_id: Uuid,
        id: &ProviderId,
        folders: &[MailFolder],
    ) -> impl Future<
        Output = Result<Option<crate::domain::models::MailboxOrganization>, EmailApiError>,
    > + Send;
    /// Enumerate the physical folder hierarchy with resolved semantic roles.
    fn folders(
        &self,
        token: &AccessToken,
    ) -> impl Future<Output = Result<Vec<MailFolder>, EmailApiError>> + Send;

    /// Fetch a current message snapshot. Missing means absent now, not permanently deleted.
    fn message(
        &self,
        token: &AccessToken,
        link_id: Uuid,
        id: &ProviderId,
        folders: &[MailFolder],
    ) -> impl Future<Output = Result<Option<MailboxMessage>, EmailApiError>> + Send;

    /// Fetch decoded attachment bytes, including attached messages where supported.
    fn attachment(
        &self,
        token: &AccessToken,
        message_id: &ProviderId,
        attachment_id: &ProviderId,
    ) -> impl Future<Output = Result<Vec<u8>, EmailApiError>> + Send;
}

/// Per-folder providers enumerate bounded pages for initial and incremental sync.
pub trait FolderChangeReader: Send + Sync + 'static {
    /// Return one page. The caller must commit work atomically with its position.
    fn folder_changes(
        &self,
        token: &AccessToken,
        folder: &ProviderId,
        position: Option<&StreamToken>,
    ) -> impl Future<Output = Result<MailboxChangePage, EmailApiError>> + Send;
}

/// Provider execution of already-authorized desired-state commands.
pub trait MailboxActionWriter: Send + Sync + 'static {
    /// Execute once and return the resulting identity (moves can replace provider IDs).
    /// Unknown transport outcomes must be reconciled by the command coordinator.
    fn apply_message_action(
        &self,
        token: &AccessToken,
        message: &ProviderId,
        action: &MessageAction,
        expected_version: Option<&str>,
    ) -> impl Future<Output = Result<MessageWriteReceipt, EmailApiError>> + Send;

    /// Submit an already-prepared draft exactly once per coordinator attempt.
    fn submit_draft(
        &self,
        token: &AccessToken,
        draft: &ProviderId,
    ) -> impl Future<Output = Result<SubmissionOutcome, EmailApiError>> + Send;
}

/// Subscription lifecycle is independent of synchronization cursors.
pub trait MailboxWatchClient: Send + Sync + 'static {
    /// List the current application's subscriptions for this delegated identity.
    fn watches(
        &self,
        token: &AccessToken,
    ) -> impl Future<Output = Result<Vec<crate::domain::models::MailboxWatchDetails>, EmailApiError>>
    + Send;
    /// Create a subscription bound to the caller's stored verification state.
    fn create_watch(
        &self,
        token: &AccessToken,
        notification_url: &str,
        lifecycle_url: &str,
        client_state: &str,
        expires_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<MailboxSubscription, EmailApiError>> + Send;

    /// Renew a known provider subscription.
    fn renew_watch(
        &self,
        token: &AccessToken,
        subscription: &ProviderId,
        expires_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<MailboxSubscription, EmailApiError>> + Send;

    /// Remove a subscription; an already-absent subscription is success.
    fn remove_watch(
        &self,
        token: &AccessToken,
        subscription: &ProviderId,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
}

/// Draft operations are issued only by a coordinator which persisted its stage
/// before a write. This port never retries an ambiguous creation or submission.
pub trait MailboxDraftClient: Send + Sync + 'static {
    /// Read a known immutable draft or its sent copy with concurrency metadata.
    fn get_draft(
        &self,
        token: &AccessToken,
        id: &ProviderId,
    ) -> impl Future<Output = Result<Option<crate::domain::models::ProviderDraft>, EmailApiError>> + Send;
    /// Find a prior creation across drafts and sent copies after a lost response.
    fn find_drafts(
        &self,
        token: &AccessToken,
        correlation: Uuid,
    ) -> impl Future<Output = Result<Vec<crate::domain::models::ProviderDraft>, EmailApiError>> + Send;
    /// Create one correlated draft. Attachments are transferred in later stages.
    fn create_draft(
        &self,
        token: &AccessToken,
        request: &crate::domain::models::DraftRequest,
    ) -> impl Future<Output = Result<crate::domain::models::ProviderDraft, EmailApiError>> + Send;
    /// Change editable content using the coordinator's observed concurrency token.
    fn update_draft(
        &self,
        token: &AccessToken,
        id: &ProviderId,
        request: &crate::domain::models::DraftRequest,
        expected_version: &str,
    ) -> impl Future<Output = Result<crate::domain::models::ProviderDraft, EmailApiError>> + Send;
    /// Delete a known draft under an explicit concurrency token.
    fn delete_draft(
        &self,
        token: &AccessToken,
        id: &ProviderId,
        expected_version: &str,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
    /// Read all current attachments for reconciliation after an interrupted upload.
    fn draft_attachments(
        &self,
        token: &AccessToken,
        id: &ProviderId,
    ) -> impl Future<Output = Result<Vec<crate::domain::models::DraftAttachment>, EmailApiError>> + Send;
    /// Add a file smaller than 3 MB, exactly once per coordinator attempt.
    fn add_attachment(
        &self,
        token: &AccessToken,
        draft: &ProviderId,
        attachment: crate::domain::models::AttachmentContent<'_>,
    ) -> impl Future<Output = Result<crate::domain::models::DraftAttachment, EmailApiError>> + Send;
    /// Remove only a specific, frozen attachment identity.
    fn delete_attachment(
        &self,
        token: &AccessToken,
        draft: &ProviderId,
        attachment: &ProviderId,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
    /// Open a resumable transfer for a 3–150 MB file.
    fn create_upload(
        &self,
        token: &AccessToken,
        draft: &ProviderId,
        attachment: crate::domain::models::AttachmentContent<'_>,
    ) -> impl Future<Output = Result<crate::domain::models::AttachmentUploadSession, EmailApiError>> + Send;
    /// Recover the server's offset after an uncertain range upload.
    fn inspect_upload(
        &self,
        url: &crate::domain::models::UploadUrl,
    ) -> impl Future<Output = Result<crate::domain::models::AttachmentUploadSession, EmailApiError>> + Send;
    /// Upload one ordered range. The final range may be shorter than the block size.
    fn upload_range(
        &self,
        url: &crate::domain::models::UploadUrl,
        offset: u64,
        total: u64,
        bytes: &[u8],
    ) -> impl Future<Output = Result<crate::domain::models::UploadProgress, EmailApiError>> + Send;
}
/// Binds request accounting to the same mailbox as credential acquisition.
pub trait ScopedMailboxRepository: Clone + Send + Sync + 'static {
    /// Return a request-scoped clone; credentials remain supplied separately.
    fn for_mailbox(&self, mailbox: MailboxAccess) -> Self;
}

/// Infrastructure admission for each HTTP request, including pagination. A
/// permit expires after a crash; callers finish it when the request completes.
pub trait MailboxRequestGate: Send + Sync + 'static {
    /// Admit one request or report when this mailbox may try again.
    fn acquire(
        &self,
        mailbox: MailboxAccess,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<uuid::Uuid, EmailApiError>> + Send + '_>>;
    /// Release a permit and share a provider cooldown with all callers.
    fn finish(
        &self,
        mailbox: MailboxAccess,
        permit: uuid::Uuid,
        retry_after: Option<std::time::Duration>,
    ) -> std::pin::Pin<Box<dyn Future<Output = ()> + Send + '_>>;
}

/// Settings capabilities which require explicit rule ownership and bounded cleanup.
pub trait MailboxSettingsClient: Send + Sync + 'static {
    /// Fetch one bounded batch of messages currently using a category.
    fn category_messages(
        &self,
        token: &AccessToken,
        name: &str,
    ) -> impl Future<Output = Result<Vec<crate::domain::models::CategoryMessage>, EmailApiError>> + Send;
    /// Read rules whose complete shape matches the Macro-owned rule contract.
    fn sender_rules(
        &self,
        token: &AccessToken,
    ) -> impl Future<Output = Result<Vec<crate::domain::models::OwnedSenderRule>, EmailApiError>> + Send;
    /// Create one exact-address trash rule with a persisted ownership nonce.
    fn create_sender_rule(
        &self,
        token: &AccessToken,
        correlation: Uuid,
        sender: &str,
    ) -> impl Future<Output = Result<ProviderId, EmailApiError>> + Send;
    /// Remove an already-verified owned rule; a missing rule is success.
    fn remove_sender_rule(
        &self,
        token: &AccessToken,
        id: &ProviderId,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
}

/// Refresh an exact binding after a definitive HTTP 401. Transport may retry
/// that rejected request once; interrupted writes must never use this path.
pub trait MailboxRejectedTokenRefresh: Send + Sync + 'static {
    /// Revalidate the binding and bypass its cached access token.
    fn refresh(
        &self,
        mailbox: MailboxAccess,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<AccessToken, EmailApiError>> + Send + '_>>;
}

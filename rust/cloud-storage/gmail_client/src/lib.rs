pub(crate) mod attachments;
pub(crate) mod auth;
pub(crate) mod contacts;
pub(crate) mod filters;
pub(crate) mod history;
pub(crate) mod labels;
pub(crate) mod messages;
pub(crate) mod profile;
mod settings;
pub(crate) mod threads;
pub(crate) mod watch;

use crate::labels::delete_gmail_label;
use regex::Regex;
use std::sync::LazyLock;

const MAX_ERROR_BODY_LEN: usize = 1024;

static EMAIL_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}").unwrap());

/// Sanitize a Gmail API error body: redact email addresses, cap length.
pub(crate) fn sanitize_error_body(body: &str) -> String {
    let redacted = EMAIL_REGEX.replace_all(body, "[REDACTED_EMAIL]");
    let trimmed = redacted.trim();
    if trimmed.len() <= MAX_ERROR_BODY_LEN {
        trimmed.to_string()
    } else {
        format!("{}… (truncated)", &trimmed[..MAX_ERROR_BODY_LEN])
    }
}

use crate::auth::{fetch_google_public_keys, verify_google_jwt};
use crate::contacts::get_self_connection;
use crate::messages::{get_message, get_message_label_ids, get_message_thread_id};
use crate::threads::get_thread;
#[allow(unused_imports)]
use mockall::automock;
use models_email::email::service;
use models_email::email::service::address::ContactInfo;
use models_email::email::service::message;
use models_email::email::service::thread::ThreadList as ServiceThreadList;
use models_email::gmail::contacts::PersonResource;
pub use models_email::gmail::error::GmailError;
pub use models_email::gmail::filters::Filter;
use models_email::gmail::inbox_sync::{
    GoogleJwtClaims, GooglePublicKeys, JwtVerificationError, KeyMap,
};
use models_email::gmail::{HistoryListResponse, MessageResource, ThreadResource};
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct GmailClient {
    /// The inner client used to make requests
    inner: reqwest::Client,
    /// The base url for Gmail API
    base_url: String,
    /// The url for fetching google certs
    certs_url: String,
    /// The url for fetching contact information via People API
    contacts_url: String,
    /// The expected audience for the jwt passed by Google
    audience: String,
    /// The GCP topic name we listen on for inbox updates
    subscription_topic: String,
}

impl GmailClient {
    pub fn new(subscription_topic: String) -> Self {
        Self {
            inner: reqwest::Client::new(),
            base_url: String::from("https://www.googleapis.com/gmail/v1"),
            certs_url: String::from("https://www.googleapis.com/oauth2/v3/certs"),
            contacts_url: String::from("https://people.googleapis.com/v1"),
            audience: "macro-gmail-webhook".to_string(),
            subscription_topic,
        }
    }

    /// Lists the num_threads most recent threads for the user
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn list_threads(
        &self,
        access_token: &str,
        num_threads: u32,
        next_page_token: Option<&str>,
    ) -> anyhow::Result<ServiceThreadList> {
        threads::list_threads(self, access_token, num_threads, next_page_token).await
    }

    // Returns a list containing the message ids belonging to the thread.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn get_message_ids_for_thread(
        &self,
        access_token: &str,
        thread_id: &str,
    ) -> anyhow::Result<Vec<String>> {
        threads::get_message_ids_for_thread(self, access_token, thread_id).await
    }

    /// Fetches a single thread and its messages from Gmail.
    /// Returns a raw Gmail ThreadResource - callers should map to service layer structs.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn get_thread(
        &self,
        access_token: &str,
        thread_id: &str,
    ) -> anyhow::Result<ThreadResource> {
        get_thread(self, access_token, thread_id).await
    }

    /// Gets the changes to a user's inbox that have occurred since start_history_id.
    /// Returns raw HistoryListResponse - callers should map to InboxChanges using convert module.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn get_history(
        &self,
        access_token: &str,
        start_history_id: &str,
    ) -> anyhow::Result<HistoryListResponse> {
        history::get_history(self, access_token, start_history_id).await
    }

    /// Returns the current history id for the user's inbox
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn get_current_history_id(&self, access_token: &str) -> anyhow::Result<String> {
        history::get_current_history_id(self, access_token).await
    }

    /// Fetches Google's public JWKS keys used for verifying OAuth 2.0 tokens
    #[tracing::instrument(skip(self), err)]
    pub async fn get_google_public_keys(&self) -> anyhow::Result<GooglePublicKeys> {
        fetch_google_public_keys(self).await
    }

    /// Verifies a Google JWT token against the provided public keys
    /// Validates the token's signature, issuer, audience, and expiration time
    #[tracing::instrument(skip(self, token, public_keys), err)]
    pub fn verify_google_token(
        &self,
        token: &str,
        public_keys: KeyMap,
    ) -> std::result::Result<GoogleJwtClaims, JwtVerificationError> {
        verify_google_jwt(self, token, public_keys)
    }

    /// Registers a push notification watch on the user's inbox
    /// This will cause notifications to be sent to the subscription_topic
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn register_watch(
        &self,
        access_token: &str,
    ) -> Result<models_email::gmail::history::WatchResponse, GmailError> {
        watch::register_watch(self, access_token).await
    }

    /// Stops push notifications by revoking the notification watch
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn stop_watch(&self, access_token: &str) -> anyhow::Result<()> {
        watch::stop_watch(self, access_token).await
    }

    /// Adds and removes labels according to the provided lists
    #[tracing::instrument(
        skip(self, access_token),
        fields(provider_message_id = %provider_message_id),
        err
    )]
    pub async fn modify_message_labels(
        &self,
        access_token: &str,
        provider_message_id: &str,
        label_ids_to_add: &[String],
        label_ids_to_remove: &[String],
    ) -> anyhow::Result<()> {
        labels::modify_message_labels(
            self,
            access_token,
            provider_message_id,
            label_ids_to_add,
            label_ids_to_remove,
        )
        .await
    }

    // Batch adds and removes Gmail labels from multiple messages
    /// Returns a tuple of (successful_message_ids, failed_message_ids)
    #[tracing::instrument(
        skip(self, gmail_access_token),
        fields(message_count = %db_provider_id_tuples.len())
    )]
    pub async fn batch_modify_labels(
        &self,
        gmail_access_token: &str,
        db_provider_id_tuples: Vec<(Uuid, String)>,
        labels_to_add: Vec<String>,
        labels_to_remove: Vec<String>,
    ) -> (Vec<Uuid>, Vec<Uuid>) {
        labels::batch_modify_labels(
            self,
            gmail_access_token,
            db_provider_id_tuples,
            labels_to_add,
            labels_to_remove,
        )
        .await
    }

    /// Fetches a specific message from Gmail by its provider ID.
    /// Returns raw Gmail MessageResource - callers should map to service layer structs.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn get_message(
        &self,
        access_token: &str,
        message_provider_id: &str,
    ) -> anyhow::Result<Option<MessageResource>> {
        get_message(self, access_token, message_provider_id).await
    }

    /// Fetches a specific message's thread ID from Gmail by its provider ID
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn get_message_thread_id(
        &self,
        access_token: &str,
        message_provider_id: &str,
    ) -> anyhow::Result<Option<String>> {
        get_message_thread_id(self, access_token, message_provider_id).await
    }

    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn get_message_label_ids(
        &self,
        access_token: &str,
        message_provider_id: &str,
    ) -> anyhow::Result<Option<Vec<String>>> {
        get_message_label_ids(self, access_token, message_provider_id).await
    }

    /// Sends a new email message
    #[tracing::instrument(skip(self, access_token, message), err)]
    pub async fn send_message(
        &self,
        access_token: &str,
        message: &mut message::MessageToSend,
        from_contact: &ContactInfo,
        parent_message_id: Option<String>,
        references: Option<Vec<String>>,
    ) -> anyhow::Result<()> {
        messages::send_message(
            self,
            access_token,
            message,
            from_contact,
            parent_message_id,
            references,
        )
        .await
    }

    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn get_profile_threads_total(&self, access_token: &str) -> anyhow::Result<i32> {
        profile::get_profile_threads_total(self, access_token).await
    }

    /// Fetches an attachment from Gmail by its provider ID
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn get_attachment_data(
        &self,
        access_token: &str,
        message_id: &str,
        attachment_id: &str,
    ) -> anyhow::Result<Vec<u8>> {
        attachments::get_attachment_data(self, access_token, message_id, attachment_id).await
    }

    /// Fetches user's Gmail labels
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn fetch_user_labels(
        &self,
        access_token: &str,
        link_id: uuid::Uuid,
    ) -> anyhow::Result<Vec<service::label::Label>> {
        labels::fetch_user_labels(self, access_token, link_id).await
    }

    /// Creates a new Gmail label for the user
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn create_label(
        &self,
        access_token: &str,
        link_id: Uuid,
        label_name: &str,
    ) -> Result<service::label::Label, GmailError> {
        labels::create_label(self, access_token, link_id, label_name).await
    }

    /// Deletes a Gmail label by its ID
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn delete_label(&self, access_token: &str, label_id: &str) -> Result<(), GmailError> {
        delete_gmail_label(self, access_token, label_id).await
    }

    /// Fetches the user's own contact information.
    /// Returns raw Gmail PersonResource - callers should map to service layer Contact.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn get_self_contact(&self, access_token: &str) -> anyhow::Result<PersonResource> {
        get_self_connection(self, access_token).await
    }

    /// Fetches all of the user's main contacts, handling pagination.
    /// Returns raw Gmail PersonResource objects and a sync token for future incremental updates.
    /// Callers should map PersonResource to service layer Contact.
    #[tracing::instrument(skip(self, access_token, sync_token), err)]
    pub async fn get_contacts(
        &self,
        access_token: &str,
        sync_token: Option<&str>,
    ) -> anyhow::Result<(Vec<PersonResource>, String)> {
        contacts::list_connections(self, access_token, sync_token).await
    }

    /// Fetches all of the user's "Other Contacts", handling pagination.
    /// These are typically contacts auto-created from interactions.
    /// Returns raw Gmail PersonResource objects and a sync token.
    /// Callers should map PersonResource to service layer Contact.
    #[tracing::instrument(skip(self, access_token, sync_token), err)]
    pub async fn get_other_contacts(
        &self,
        access_token: &str,
        sync_token: Option<&str>,
    ) -> anyhow::Result<(Vec<PersonResource>, String)> {
        contacts::list_other_contacts(self, access_token, sync_token).await
    }

    /// Gets the email signature for a specific email address
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn get_email_signature(
        &self,
        access_token: &str,
        email_address: &str,
    ) -> Result<Option<String>, GmailError> {
        settings::get_email_signature(self, access_token, email_address).await
    }

    /// Blocks a sender by creating a filter that sends their emails to SPAM.
    /// This replicates the "Block Sender" functionality in the Gmail UI.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn block_sender(
        &self,
        access_token: &str,
        email_to_block: &str,
    ) -> Result<Filter, GmailError> {
        filters::block_sender(self, access_token, email_to_block).await
    }

    /// Creates a new Gmail filter.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn create_filter(
        &self,
        access_token: &str,
        filter: Filter,
    ) -> Result<Filter, GmailError> {
        filters::create_filter(self, access_token, filter).await
    }

    /// Lists all filters for the user.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn list_filters(&self, access_token: &str) -> Result<Vec<Filter>, GmailError> {
        filters::list_filters(self, access_token).await
    }

    /// Gets a specific filter by ID.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn get_filter(
        &self,
        access_token: &str,
        filter_id: &str,
    ) -> Result<Filter, GmailError> {
        filters::get_filter(self, access_token, filter_id).await
    }

    /// Deletes a filter by ID.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn delete_filter(
        &self,
        access_token: &str,
        filter_id: &str,
    ) -> Result<(), GmailError> {
        filters::delete_filter(self, access_token, filter_id).await
    }

    /// Finds and returns any existing "block" filters for a specific email address.
    /// This can be used to check if a user is already blocked.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn find_block_filter_for_sender(
        &self,
        access_token: &str,
        email_address: &str,
    ) -> Result<Option<Filter>, GmailError> {
        filters::find_block_filter_for_sender(self, access_token, email_address).await
    }

    /// Unblocks a sender by finding and deleting their block filter.
    /// Returns true if a filter was found and deleted, false if no filter existed.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn unblock_sender(
        &self,
        access_token: &str,
        email_address: &str,
    ) -> Result<bool, GmailError> {
        filters::unblock_sender(self, access_token, email_address).await
    }

    /// Lists all blocked senders by finding filters that send emails to TRASH.
    /// Returns a list of email addresses that are currently blocked.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn list_blocked_senders(
        &self,
        access_token: &str,
    ) -> Result<Vec<String>, GmailError> {
        filters::list_blocked_senders(self, access_token).await
    }
}

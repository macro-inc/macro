pub(crate) mod attachments;
pub(crate) mod auth;
pub(crate) mod contacts;
mod error;
pub(crate) mod filters;
pub(crate) mod history;
pub(crate) mod labels;
pub(crate) mod messages;
pub(crate) mod profile;
pub(crate) mod threads;
pub(crate) mod watch;

#[cfg(test)]
mod test;

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
        return trimmed.to_string();
    }

    let truncate_at = trimmed
        .char_indices()
        .map(|(index, _)| index)
        .take_while(|index| *index <= MAX_ERROR_BODY_LEN)
        .last()
        .unwrap_or(0);
    format!("{}… (truncated)", &trimmed[..truncate_at])
}

use crate::auth::{fetch_google_public_keys, verify_google_jwt};
use crate::contacts::get_self_connection;
use crate::messages::{get_message, get_message_label_ids, list_messages};
use crate::threads::get_thread;
pub use error::GmailApiHttpError;
use models_email::gmail::contacts::PersonResource;
pub use models_email::gmail::filters::Filter;
use models_email::gmail::inbox_sync::{
    GoogleJwtClaims, GooglePublicKeys, JwtVerificationError, KeyMap,
};
use models_email::gmail::labels::GmailLabel;
use models_email::gmail::{
    GmailUserProfile, HistoryListResponse, ListThreadsResponse, MessageResource, ThreadResource,
};

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
        Self::new_with_urls(
            subscription_topic,
            "https://www.googleapis.com/gmail/v1".to_string(),
            "https://people.googleapis.com/v1".to_string(),
            "https://www.googleapis.com/oauth2/v3/certs".to_string(),
            "macro-gmail-webhook".to_string(),
        )
    }

    /// Creates a client with injectable Gmail, People, and JWKS URLs.
    ///
    /// This constructor supports deterministic tests and Gmail-compatible
    /// endpoints. HTTP transport details and endpoint values remain private to
    /// this crate.
    pub fn new_with_urls(
        subscription_topic: String,
        gmail_url: String,
        people_url: String,
        jwks_url: String,
        audience: String,
    ) -> Self {
        Self {
            inner: reqwest::Client::new(),
            base_url: gmail_url.trim_end_matches('/').to_string(),
            certs_url: jwks_url,
            contacts_url: people_url.trim_end_matches('/').to_string(),
            audience,
            subscription_topic,
        }
    }

    /// Lists the num_threads most recent threads for the user, optionally
    /// filtered to threads carrying all of the given Gmail label ids
    /// (an empty slice applies no filter).
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn list_threads(
        &self,
        access_token: &str,
        num_threads: u32,
        next_page_token: Option<&str>,
        label_ids: &[&str],
    ) -> Result<ListThreadsResponse, GmailApiHttpError> {
        threads::list_threads(self, access_token, num_threads, next_page_token, label_ids).await
    }

    /// Lists the `num_messages` most recent message provider ids for the user,
    /// optionally filtered to messages carrying all of the given Gmail label
    /// ids (an empty slice applies no filter). Capped at 500 by the Gmail API.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn list_messages(
        &self,
        access_token: &str,
        num_messages: u32,
        label_ids: &[&str],
    ) -> Result<Vec<String>, GmailApiHttpError> {
        list_messages(self, access_token, num_messages, label_ids).await
    }

    // Returns a list containing the message ids belonging to the thread.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn get_message_ids_for_thread(
        &self,
        access_token: &str,
        thread_id: &str,
    ) -> Result<Vec<String>, GmailApiHttpError> {
        threads::get_message_ids_for_thread(self, access_token, thread_id).await
    }

    /// Fetches a single thread and its messages from Gmail.
    /// Returns a raw Gmail ThreadResource - callers should map to service layer structs.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn get_thread(
        &self,
        access_token: &str,
        thread_id: &str,
    ) -> Result<ThreadResource, GmailApiHttpError> {
        get_thread(self, access_token, thread_id).await
    }

    /// Gets the changes to a user's inbox that have occurred since start_history_id.
    /// Returns raw HistoryListResponse - callers should map to InboxChanges using convert module.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn get_history(
        &self,
        access_token: &str,
        start_history_id: &str,
    ) -> Result<HistoryListResponse, GmailApiHttpError> {
        history::get_history(self, access_token, start_history_id).await
    }

    /// Fetches the user's raw Gmail profile.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn get_profile(
        &self,
        access_token: &str,
    ) -> Result<GmailUserProfile, GmailApiHttpError> {
        profile::get_profile(self, access_token).await
    }

    /// Fetches Google's public JWKS keys used for verifying OAuth 2.0 tokens.
    #[tracing::instrument(skip(self), err)]
    pub async fn get_google_public_keys(&self) -> Result<GooglePublicKeys, GmailApiHttpError> {
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
    ) -> Result<models_email::gmail::history::WatchResponse, GmailApiHttpError> {
        watch::register_watch(self, access_token).await
    }

    /// Stops push notifications by revoking the notification watch
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn stop_watch(&self, access_token: &str) -> Result<(), GmailApiHttpError> {
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
    ) -> Result<(), GmailApiHttpError> {
        labels::modify_message_labels(
            self,
            access_token,
            provider_message_id,
            label_ids_to_add,
            label_ids_to_remove,
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
    ) -> Result<Option<MessageResource>, GmailApiHttpError> {
        get_message(self, access_token, message_provider_id).await
    }

    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn get_message_label_ids(
        &self,
        access_token: &str,
        message_provider_id: &str,
    ) -> Result<Option<Vec<String>>, GmailApiHttpError> {
        get_message_label_ids(self, access_token, message_provider_id).await
    }

    /// Sends prepared MIME bytes and returns Gmail's provider identifiers.
    #[tracing::instrument(skip(self, access_token, mime), err)]
    pub async fn send_message(
        &self,
        access_token: &str,
        mime: &[u8],
        thread_id: Option<&str>,
    ) -> Result<models_email::gmail::SentMessageResource, GmailApiHttpError> {
        messages::send_message(self, access_token, mime, thread_id).await
    }

    /// Fetches an attachment from Gmail by its provider ID
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn get_attachment_data(
        &self,
        access_token: &str,
        message_id: &str,
        attachment_id: &str,
    ) -> Result<Vec<u8>, GmailApiHttpError> {
        attachments::get_attachment_data(self, access_token, message_id, attachment_id).await
    }

    /// Fetches user's Gmail labels
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn fetch_user_labels(
        &self,
        access_token: &str,
    ) -> Result<Vec<GmailLabel>, GmailApiHttpError> {
        labels::fetch_user_labels(self, access_token).await
    }

    /// Creates a new Gmail label from a raw Gmail label request.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn create_label(
        &self,
        access_token: &str,
        request: &GmailLabel,
    ) -> Result<GmailLabel, GmailApiHttpError> {
        labels::create_label(self, access_token, request).await
    }

    /// Deletes a Gmail label by its ID.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn delete_label(
        &self,
        access_token: &str,
        label_id: &str,
    ) -> Result<(), GmailApiHttpError> {
        labels::delete_gmail_label(self, access_token, label_id).await
    }

    /// Fetches the user's own contact information.
    /// Returns raw Gmail PersonResource - callers should map to service layer Contact.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn get_self_contact(
        &self,
        access_token: &str,
    ) -> Result<PersonResource, GmailApiHttpError> {
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
    ) -> Result<(Vec<PersonResource>, String), GmailApiHttpError> {
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
    ) -> Result<(Vec<PersonResource>, String), GmailApiHttpError> {
        contacts::list_other_contacts(self, access_token, sync_token).await
    }

    /// Creates a new Gmail filter.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn create_filter(
        &self,
        access_token: &str,
        filter: Filter,
    ) -> Result<Filter, GmailApiHttpError> {
        filters::create_filter(self, access_token, filter).await
    }

    /// Lists all filters for the user.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn list_filters(&self, access_token: &str) -> Result<Vec<Filter>, GmailApiHttpError> {
        filters::list_filters(self, access_token).await
    }

    /// Deletes a filter by ID.
    #[tracing::instrument(skip(self, access_token), err)]
    pub async fn delete_filter(
        &self,
        access_token: &str,
        filter_id: &str,
    ) -> Result<(), GmailApiHttpError> {
        filters::delete_filter(self, access_token, filter_id).await
    }
}
